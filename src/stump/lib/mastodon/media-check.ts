// Checks a media file against the instance's reported media limits before upload.
// Limits: configuration.media_attachments of GET /api/v2/instance, https://docs.joinmastodon.org/methods/instance/

import { graphemeLength } from './text.ts';
import type { Problem } from './errors.ts';
import type { InstanceInfo } from './instance.ts';
import type { MediaFile, StatusDraftOptions } from './types.ts';

function byteLength(b: MediaFile['bytes']): number {
  return b instanceof Blob ? b.size : b.byteLength;
}

export function checkMedia(file: MediaFile, info: InstanceInfo, options: StatusDraftOptions = {}): Problem[] {
  const problems: Problem[] = [];
  const requireAlt = options.requireAltText ?? true;
  const alt = file.description?.trim() ?? '';
  if (requireAlt && alt === '') problems.push({ code: 'alt_text_missing', message: 'Media needs alt text', path: 'description' });
  const limit = info.media.descriptionLimit;
  if (limit !== null && file.description && graphemeLength(file.description) > limit) {
    problems.push({ code: 'alt_text_too_long', message: `Alt text is over ${limit} characters`, path: 'description' });
  }
  const mimes = info.media.supportedMimeTypes;
  if (mimes && !mimes.includes(file.mimeType)) {
    problems.push({ code: 'media_type_unsupported', message: `${info.domain} does not accept ${file.mimeType}`, path: 'mimeType' });
  }
  const size = byteLength(file.bytes);
  if (size === 0) problems.push({ code: 'media_empty', message: 'The file is empty', path: 'bytes' });
  const sizeLimit = file.mimeType.startsWith('video/') ? info.media.videoSizeLimit : file.mimeType.startsWith('image/') ? info.media.imageSizeLimit : null;
  if (sizeLimit !== null && size > sizeLimit) {
    problems.push({ code: 'media_too_large', message: `${size} bytes; ${info.domain} allows ${sizeLimit}`, path: 'bytes' });
  }
  if (file.focus && (Math.abs(file.focus.x) > 1 || Math.abs(file.focus.y) > 1)) {
    problems.push({ code: 'focus_out_of_range', message: 'Focus x and y run from -1 to 1', path: 'focus' });
  }
  return problems;
}
