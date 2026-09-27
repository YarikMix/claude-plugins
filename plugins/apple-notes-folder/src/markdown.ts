import TurndownService from 'turndown';
import { Marked, type Tokens } from 'marked';
import { ToolError } from './errors.js';

export const MAX_MARKDOWN_CHARS = 200_000;

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const PLACEHOLDER = /^note-image:(\d+)$/;

export type ImageResolver = (href: string) => Promise<string>;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Заменяет картинки тела заметки заглушками note-image:N; base64 остаётся только в images. */
export function extractImages(html: string): { html: string; images: string[] } {
  const images: string[] = [];
  const out = html.replace(IMG_TAG, (tag) => {
    const m = SRC_ATTR.exec(tag);
    images.push(m ? (m[1] ?? m[2]) : '');
    const n = images.length;
    return `<img src="note-image:${n}" alt="картинка ${n}">`;
  });
  return { html: out, images };
}

function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  td.addRule('strike', {
    filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });
  return td;
}

export function htmlToMarkdown(html: string): { markdown: string; images: string[] } {
  const { html: stripped, images } = extractImages(html);
  let markdown = makeTurndown().turndown(stripped).trim();
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    const marker = `\n\n[… обрезано: заметка длиннее ${MAX_MARKDOWN_CHARS} символов]`;
    markdown = markdown.slice(0, MAX_MARKDOWN_CHARS - marker.length) + marker;
  }
  return { markdown, images };
}

export function makeResolver(existing: string[] | null, load: (path: string) => Promise<string>): ImageResolver {
  return async (href) => {
    const m = PLACEHOLDER.exec(href);
    if (!m) return load(href);
    const n = Number(m[1]);
    if (!existing || n < 1 || n > existing.length) {
      const has = existing ? ` (в заметке картинок: ${existing.length})` : '';
      throw new ToolError('IMAGE_REF', `Ссылка ${href} не соответствует ни одной картинке заметки${has}.`);
    }
    return existing[n - 1];
  };
}

export async function markdownToHtml(md: string, resolve: ImageResolver): Promise<string> {
  const marked = new Marked({ gfm: true });
  const tokens = marked.lexer(md);

  const hrefs: string[] = [];
  marked.walkTokens(tokens, (t) => {
    if (t.type === 'image') hrefs.push((t as Tokens.Image).href);
  });
  const srcs = new Map<string, string>();
  for (const href of hrefs) if (!srcs.has(href)) srcs.set(href, await resolve(href));

  marked.use({
    renderer: {
      html(token) {
        return escapeHtml(token.text);
      },
      image(token) {
        return `<img src="${srcs.get(token.href)}">`;
      },
      paragraph(token) {
        return `<div>${this.parser.parseInline(token.tokens)}</div>\n`;
      },
      heading(token) {
        const d = Math.min(token.depth, 3);
        return `<h${d}>${this.parser.parseInline(token.tokens)}</h${d}>\n`;
      },
      strong(token) {
        return `<b>${this.parser.parseInline(token.tokens)}</b>`;
      },
      em(token) {
        return `<i>${this.parser.parseInline(token.tokens)}</i>`;
      },
    },
  });
  return marked.parser(tokens);
}

export function titleHtml(title: string): string {
  return `<div><h1>${escapeHtml(title)}</h1></div>\n`;
}
