/**
 * A small well-formedness-checking XML parser for feeds (the Workers runtime has no DOMParser).
 *
 * It resolves namespaces, handles CDATA, comments, processing instructions and a DOCTYPE (skipped;
 * internal entities are never expanded, so there is no entity-expansion attack). It decodes the five
 * predefined entities and numeric references; any other `&name;` is left as written for the text
 * stage to decode (feeds in the wild use `&nbsp;`). Mismatched or unclosed tags throw `XmlError`:
 * a malformed feed is an error shown on the watch (STUMP-WATCH-002.3), not a best-effort guess.
 */
import { stripControls } from './text.ts'

export class XmlError extends Error {
  position: number
  constructor(message: string, position: number) {
    super(`${message} (at character ${position})`)
    this.name = 'XmlError'
    this.position = position
  }
}

export interface XmlNode {
  /** Local name without prefix. */
  local: string
  prefix: string
  /** Resolved namespace URI, `''` for none, `urn:unbound:<prefix>` for an undeclared prefix. */
  ns: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Character data directly inside this element, concatenated (CDATA included). */
  text: string
  /** Child text and element order, for serialising mixed content (Atom xhtml). */
  parts: (string | XmlNode)[]
}

const MAX_DEPTH = 256
const MAX_NODES = 250_000
const NAME_START = /[A-Za-z_:À-￿]/
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

function decodeXmlText(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (_w, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�'
      return String.fromCodePoint(cp)
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[body] as string
  })
}

interface RawElement {
  qname: string
  attrs: [string, string][]
  selfClosing: boolean
  end: number
}

function readName(src: string, from: number): { name: string; end: number } {
  let i = from
  if (!NAME_START.test(src[i] ?? '')) throw new XmlError('Expected a name', i)
  while (i < src.length && /[A-Za-z0-9_:.\-·À-￿]/.test(src[i])) i++
  return { name: src.slice(from, i), end: i }
}

function readStartTag(src: string, from: number): RawElement {
  const { name, end } = readName(src, from + 1)
  let i = end
  const attrs: [string, string][] = []
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++
    if (i >= src.length) throw new XmlError('Unterminated tag', from)
    if (src[i] === '>') return { qname: name, attrs, selfClosing: false, end: i + 1 }
    if (src[i] === '/') {
      if (src[i + 1] !== '>') throw new XmlError('Stray "/" in tag', i)
      return { qname: name, attrs, selfClosing: true, end: i + 2 }
    }
    const attr = readName(src, i)
    i = attr.end
    while (i < src.length && /\s/.test(src[i])) i++
    if (src[i] !== '=') throw new XmlError(`Attribute "${attr.name}" has no value`, i)
    i++
    while (i < src.length && /\s/.test(src[i])) i++
    const quote = src[i]
    if (quote !== '"' && quote !== "'") throw new XmlError(`Attribute "${attr.name}" value is not quoted`, i)
    const close = src.indexOf(quote, i + 1)
    if (close < 0) throw new XmlError('Unterminated attribute value', i)
    const raw = src.slice(i + 1, close)
    if (raw.includes('<')) throw new XmlError(`"<" inside attribute "${attr.name}"`, i)
    attrs.push([attr.name, decodeXmlText(raw)])
    i = close + 1
  }
}

function splitQName(q: string): { prefix: string; local: string } {
  const at = q.indexOf(':')
  return at < 0 ? { prefix: '', local: q } : { prefix: q.slice(0, at), local: q.slice(at + 1) }
}

export function parseXml(input: string): XmlNode {
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  let i = 0
  let root: XmlNode | null = null
  const stack: { node: XmlNode; qname: string; scope: Map<string, string> }[] = []
  let count = 0

  const add = (text: string) => {
    const top = stack[stack.length - 1]
    if (!top) {
      if (text.trim() !== '') throw new XmlError('Text outside the root element', i)
      return
    }
    top.node.text += text
    top.node.parts.push(text)
  }

  while (i < src.length) {
    if (src[i] !== '<') {
      const next = src.indexOf('<', i)
      const end = next < 0 ? src.length : next
      add(decodeXmlText(stripControls(src.slice(i, end))))
      i = end
      continue
    }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      if (end < 0) throw new XmlError('Unterminated comment', i)
      i = end + 3
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9)
      if (end < 0) throw new XmlError('Unterminated CDATA section', i)
      if (!stack.length) throw new XmlError('CDATA outside the root element', i)
      add(stripControls(src.slice(i + 9, end)))
      i = end + 3
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2)
      if (end < 0) throw new XmlError('Unterminated processing instruction', i)
      i = end + 2
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset in [ ]. Skipped, never expanded.
      let depth = 0
      let j = i + 2
      for (; j < src.length; j++) {
        const c = src[j]
        if (c === '[') depth++
        else if (c === ']') depth--
        else if (c === '>' && depth <= 0) break
      }
      if (j >= src.length) throw new XmlError('Unterminated declaration', i)
      i = j + 1
    } else if (src[i + 1] === '/') {
      const { name, end } = readName(src, i + 2)
      let j = end
      while (j < src.length && /\s/.test(src[j])) j++
      if (src[j] !== '>') throw new XmlError('Malformed end tag', i)
      const top = stack.pop()
      if (!top) throw new XmlError(`Unexpected end tag </${name}>`, i)
      if (top.qname !== name) throw new XmlError(`End tag </${name}> does not match <${top.qname}>`, i)
      i = j + 1
    } else {
      const el = readStartTag(src, i)
      if (++count > MAX_NODES) throw new XmlError('Document has too many elements', i)
      if (stack.length >= MAX_DEPTH) throw new XmlError('Document is nested too deeply', i)
      if (!stack.length && root) throw new XmlError('More than one root element', i)
      const parentScope = stack.length ? stack[stack.length - 1].scope : new Map<string, string>([['xml', XML_NS]])
      const scope = new Map(parentScope)
      const attrs: Record<string, string> = {}
      for (const [k, v] of el.attrs) {
        if (k === 'xmlns') scope.set('', v)
        else if (k.startsWith('xmlns:')) scope.set(k.slice(6), v)
        else attrs[k] = v
      }
      const { prefix, local } = splitQName(el.qname)
      const ns = scope.get(prefix) ?? (prefix ? `urn:unbound:${prefix}` : '')
      const node: XmlNode = { local, prefix, ns, attrs, children: [], text: '', parts: [] }
      const parent = stack[stack.length - 1]
      if (parent) {
        parent.node.children.push(node)
        parent.node.parts.push(node)
      } else {
        root = node
      }
      if (!el.selfClosing) stack.push({ node, qname: el.qname, scope })
      i = el.end
    }
  }
  if (stack.length) throw new XmlError(`Element <${stack[stack.length - 1].qname}> is never closed`, src.length)
  if (!root) throw new XmlError('No root element', 0)
  return root
}

/** True when `n` is the element `local` in namespace `ns` (or carries the conventional prefix when its prefix is undeclared). */
export function is(n: XmlNode, local: string, ns = '', conventionalPrefix?: string): boolean {
  if (n.local !== local) return false
  if (n.ns === ns) return true
  return conventionalPrefix !== undefined && n.ns.startsWith('urn:unbound:') && n.prefix === conventionalPrefix
}

export function child(n: XmlNode, local: string, ns = '', conventionalPrefix?: string): XmlNode | undefined {
  return n.children.find((c) => is(c, local, ns, conventionalPrefix))
}

export function childrenOf(n: XmlNode, local: string, ns = '', conventionalPrefix?: string): XmlNode[] {
  return n.children.filter((c) => is(c, local, ns, conventionalPrefix))
}

/** All text below an element, in document order. */
export function textOf(n: XmlNode): string {
  let out = ''
  for (const p of n.parts) out += typeof p === 'string' ? p : textOf(p)
  return out
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Serialise an element's content as tag soup without attributes (Atom `type="xhtml"`), for the text stage to reduce. */
export function innerMarkup(n: XmlNode): string {
  let out = ''
  for (const p of n.parts) {
    if (typeof p === 'string') out += escapeText(p)
    else out += `<${p.local}>${innerMarkup(p)}</${p.local}>`
  }
  return out
}
