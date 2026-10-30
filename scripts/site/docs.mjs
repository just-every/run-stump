// The run site's docs, built in Node when `rer build --site` renders the site:
// docs/site.json lists the published pages in reading order, grouped in
// sections, and each page is one Markdown file in docs/. Raw HTML in the
// Markdown shows as text. Headings get GitHub-style ids and the page's h2s and
// h3s become "On this page". A broken link, a missing file, a code block
// without a language or a build machine path fails the build with every
// problem listed at once.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Marked } from 'marked';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = value => (typeof value === 'string' ? value.trim() : '');
const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const decodeHtml = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const collapse = value => value.replace(/\s+/g, ' ').trim();
const machinePath = /(?<![\w.@~-])\/(?:Users|home|private|tmp|var|Volumes|root)\/[^\s"'`<\\]*/g;
const languages = { sh: 'Shell', bash: 'Shell', shell: 'Shell', console: 'Shell', json: 'JSON', ts: 'TypeScript', js: 'JavaScript', text: 'Text', http: 'HTTP', csv: 'CSV', markdown: 'Markdown', md: 'Markdown' };
/** Site pages outside /docs that a docs page may link to. */
const sitePaths = new Set(['/', '/run', '/contract']);

function slugger() {
  const seen = new Map();
  return value => {
    const base = value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    let slug = base;
    while (seen.has(slug)) { const count = (seen.get(base) ?? 0) + 1; seen.set(base, count); slug = `${base}-${count}`; }
    seen.set(slug, 0);
    return slug;
  };
}

function render(markdown) {
  const slug = slugger(), toc = [], ids = [], links = [], problems = [], sections = [];
  let current = null, first = true;
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const label = collapse(decodeHtml(this.parser.parseInline(tokens, this.parser.textRenderer)));
        // A file's own level-1 title gives way to the title in docs/site.json.
        if (depth === 1) { if (!first) problems.push('has a second level-1 heading'); first = false; return ''; }
        first = false;
        const id = slug(label);
        ids.push(id);
        if (depth === 2 || depth === 3) { toc.push({ depth, id, text: label }); current = { anchor: id, titlePath: [label], text: '' }; sections.push(current); }
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      paragraph({ tokens }) {
        first = false;
        const html = this.parser.parseInline(tokens);
        if (current) current.text += `${collapse(decodeHtml(this.parser.parseInline(tokens, this.parser.textRenderer)))} `;
        return `<p>${html}</p>\n`;
      },
      code({ text: code, lang }) {
        first = false;
        const language = (lang ?? '').trim().split(/\s+/)[0].toLowerCase();
        if (!language) problems.push('has a code block without a language');
        const name = languages[language] ?? language.toUpperCase();
        return `<div class="docs-code" data-copy-scope><div class="docs-code-head"><span>${escapeHtml(name || 'Code')}</span><button type="button" class="docs-copy" data-copy aria-label="Copy code" hidden></button></div><pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre></div>\n`;
      },
      html({ text: raw }) { return escapeHtml(raw); },
      link({ href, title, tokens }) {
        links.push(href);
        return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href }) { problems.push(`has an image (${href}); the docs publish text only`); return ''; },
    },
  });
  const html = marked.parse(markdown, { async: false })
    .replace(/<table>/g, '<div class="docs-table" role="region" tabindex="0" aria-label="Table"><table>')
    .replace(/<\/table>/g, '</table></div>');
  return { html, toc, ids, links, problems, sections };
}

/** Reads docs/site.json and every page it lists from `root` (the checkout the site builds from), renders them and checks every link between them. */
export function buildDocs(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(join(root, 'docs/site.json'), 'utf8'));
  const problems = [], slugs = new Set();
  const sections = (manifest.sections ?? []).map((section, s) => {
    const title = text(section.title);
    if (!title) problems.push(`section ${s + 1} has no title`);
    return {
      title,
      pages: (section.pages ?? []).map((page, p) => {
        const where = `page ${p + 1} of "${title}"`;
        const entry = { slug: text(page.slug), title: text(page.title), file: text(page.file), summary: text(page.summary), section: title };
        if (!slugPattern.test(entry.slug)) problems.push(`${where}: slug "${entry.slug}" must be lowercase words joined by hyphens`);
        if (slugs.has(entry.slug)) problems.push(`${where}: slug "${entry.slug}" is used twice`);
        slugs.add(entry.slug);
        if (!entry.title || !entry.summary) problems.push(`${where}: needs a title and a summary`);
        if (!entry.file.endsWith('.md') || entry.file.includes('/') || !existsSync(join(root, 'docs', entry.file))) problems.push(`${where}: docs/${entry.file} is not a Markdown file in docs/`);
        return entry;
      }),
    };
  });
  if (problems.length) throw new Error(`docs/site.json is invalid:\n- ${problems.join('\n- ')}`);
  const pages = sections.flatMap(section => section.pages);
  const rendered = new Map(pages.map(page => [page.slug, render(readFileSync(join(root, 'docs', page.file), 'utf8'))]));
  for (const page of pages) {
    const own = rendered.get(page.slug), report = problem => problems.push(`docs/${page.file}: ${problem}`);
    own.problems.forEach(report);
    for (const href of own.links) {
      if (/^(?:https?:|mailto:)/i.test(href) || sitePaths.has(href)) continue;
      const local = /^\/docs(?:\/([^#?/]+))?\/?(?:#(.+))?$/.exec(href), inPage = /^#(.+)$/.exec(href);
      if (inPage) { if (!own.ids.includes(inPage[1])) report(`links to ${href}, which is not a heading on this page`); }
      else if (!local) report(`links to ${href}; link to other pages as /docs/<slug>, or use a full https:// address`);
      else if (local[1] && !rendered.has(local[1])) report(`links to ${href}, but docs/site.json has no page "${local[1]}"`);
      else if (local[2] && !(local[1] ? rendered.get(local[1]).ids : []).includes(local[2])) report(`links to ${href}, which is not a heading on that page`);
    }
    for (const leak of new Set(own.html.match(machinePath) ?? [])) report(`contains ${leak}, a build machine path`);
  }
  if (problems.length) throw new Error(`Docs: ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  return {
    sections,
    pages: pages.map(page => {
      const { html, toc, sections: searchSections } = rendered.get(page.slug);
      return { ...page, html, toc, searchSections: searchSections.map(section => ({ ...section, titlePath: [page.title, ...section.titlePath], text: section.text.trim() })) };
    }),
  };
}
