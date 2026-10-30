// One HTML document for every run site page: the head with its title,
// description, social card and icons, then the page itself.
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const SITE = 'https://run-stump.com'

/** Turns on each Copy button where the clipboard can be written; the buttons ship hidden, so a page without script shows none. */
const copyScript = "document.querySelectorAll('[data-copy]').forEach(function(b){if(!navigator.clipboard)return;b.hidden=false;b.addEventListener('click',function(){var s=b.closest('[data-copy-scope]'),c=s&&s.querySelector('code');if(!c)return;navigator.clipboard.writeText(c.textContent).then(function(){b.setAttribute('data-done','');setTimeout(function(){b.removeAttribute('data-done')},1600)})})})"

/** Marks the "On this page" entry for the section in view: the last heading scrolled past, else the first. */
const tocScript = "(function(){var l=[].slice.call(document.querySelectorAll('.docs-toc a[href^=\"#\"],.docs-toc-compact a[href^=\"#\"]'));if(!l.length)return;var h=l.map(function(a){return document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))});function m(){var c=null;h.forEach(function(e){if(e&&e.getBoundingClientRect().top<=120&&(!c||e.getBoundingClientRect().top>=c.getBoundingClientRect().top))c=e});c=c||h.filter(Boolean)[0];l.forEach(function(a,i){if(h[i]===c)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current')})}m();addEventListener('scroll',m,{passive:true})})()"

/** `scripts` are the module URLs of the site islands the page uses (rer build --site bundles them). */
export function siteDocument({ title, description, path, styles, scripts = [], body }: { title: string; description: string; path: string; styles: string[]; scripts?: string[]; body: string }) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${escape(title)}</title><meta name="description" content="${escape(description)}">`
    + `<link rel="canonical" href="${SITE}${path === '/' ? '/' : path}">`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="Stump"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">`
    + `<meta property="og:url" content="${SITE}${path}"><meta property="og:image" content="${SITE}/brand/social.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`
    + '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32"><link rel="apple-touch-icon" href="/apple-touch-icon.png">'
    + '<link rel="preload" href="/fonts/gantari/gantari-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous"><link rel="preload" href="/fonts/gantari/gantari-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous">'
    + '<link rel="stylesheet" href="/fonts/fonts.css">' + styles.map(href => `<link rel="stylesheet" href="${escape(href)}">`).join('')
    + scripts.map(src => `<script type="module" src="${escape(src)}"></script>`).join('')
    + `</head><body>${body}<script>${copyScript};${tocScript}</script></body></html>`
}
