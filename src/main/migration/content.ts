import { createHash } from 'node:crypto';

import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

import type { CanonicalNote } from '../../shared/domain';

const allowedTags = ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'img'];
const allowedAttributes = ['href', 'src', 'alt'];
const allowedTagSet = new Set(allowedTags);

export type ContentHashContext = {
  title?: string;
  attachmentSha256?: string[];
  folderPath?: string;
};

export type NormalizedContent = {
  html: string;
  plainText: string;
  contentHash: string;
  warnings: CanonicalNote['warnings'];
};

export function normalizeContent(
  inputHtml: string,
  context: ContentHashContext = {}
): NormalizedContent {
  const window = new JSDOM('').window;
  const source = JSDOM.fragment(inputHtml);
  const unsupportedTags = new Set(
    [...source.querySelectorAll('*')]
      .map((element) => element.tagName.toLowerCase())
      .filter((tag) => !allowedTagSet.has(tag) && tag !== 'script')
  );
  const purifier = createDOMPurify(window);
  const html = purifier.sanitize(inputHtml, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes
  });
  const plainText = JSDOM.fragment(html).textContent?.trim() ?? '';
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify({
        title: context.title ?? '',
        html,
        attachments: context.attachmentSha256 ?? [],
        folderPath: context.folderPath ?? ''
      })
    )
    .digest('hex');

  window.close();

  return {
    html,
    plainText,
    contentHash,
    warnings: [...unsupportedTags].map((tag) => ({
      code: 'unsupported-content' as const,
      message: `包含无法自动迁移的 HTML 标签：${tag}`
    }))
  };
}
