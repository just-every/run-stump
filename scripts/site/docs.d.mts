export type DocsTocEntry = { depth: 2 | 3; id: string; text: string };
export type DocsPageMeta = { slug: string; title: string; file: string; summary: string; section: string };
export type DocsSection = { title: string; pages: DocsPageMeta[] };
export type DocsSearchSection = { anchor: string; titlePath: string[]; text: string };
export type DocsPage = DocsPageMeta & { html: string; toc: DocsTocEntry[]; searchSections: DocsSearchSection[] };
export function buildDocs(root?: string): { sections: DocsSection[]; pages: DocsPage[] };
