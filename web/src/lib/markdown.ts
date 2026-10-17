// Markdown to HTML for challenge specs. marked passes raw HTML through, so everything is
// sanitized before it reaches dangerouslySetInnerHTML; a spec written by a user can then
// carry formatting but not scripts or event handlers.
import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function renderMarkdown(md: string) {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}
