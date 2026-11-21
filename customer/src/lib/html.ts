/** Server text is inline HTML (<strong>, lists, tables): shown as plain words here. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|li|h[1-6]|tr|section|ul|ol|table)>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/t[dh]>/g, ' · ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
