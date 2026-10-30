// Link-preview (Open Graph) tags for share sites. No imports, so scripts/og-image.mjs can
// load this file with plain Node too.
//
// here.now adds og:/twitter: tags to a page that has none, but a site with an index.html
// can't point them at its own image (viewer.ogImagePath is ignored), and it leaves tags
// that are already in the HTML alone. The main site's served page carries here.now's tags
// for the main site, so a share copied from it would unfurl as the empty "Drop a file"
// screen. So: strip those, reserve a fixed-size slot, and once here.now has told us the
// new site's URL, fill the slot with tags for this print's own og.jpg. The slot keeps the
// byte size the same, because file sizes are declared before the URL is known.

export const OG_IMAGE = 'og.jpg';
export const OG_W = 1200;
export const OG_H = 630;

const OPEN = '<!--og-->';
const CLOSE = '<!--/og-->';
const SLOT_BYTES = 2048;

/** Only touch the end of <head>: the inlined bundle above it contains these strings too. */
function splitTail(html: string): [string, string] {
  // written as <\/ so this file can sit inside the page's own inline <script>
  const i = Math.max(0, html.lastIndexOf('<\/script>'));
  return [html.slice(0, i), html.slice(i)];
}

/** Drop og:/twitter: tags, i.e. the ones here.now added to the main site's page. */
export function stripSocialMeta(html: string): string {
  const [head, tail] = splitTail(html);
  return head + tail.replace(/<meta (?:property|name)="(?:og|twitter):[^>]*>\s*/g, '');
}

/** Strip the main site's tags and leave an empty slot before </head>. */
export function withSocialSlot(html: string): string {
  const [head, tail] = splitTail(stripSocialMeta(html));
  const i = tail.lastIndexOf('</head>');
  if (i < 0) return head + tail;
  return head + tail.slice(0, i) + OPEN + ' '.repeat(SLOT_BYTES) + CLOSE + tail.slice(i);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const meta = (attr: string, key: string, value: string) => `<meta ${attr}="${key}" content="${esc(value)}" />`;

export function socialTags(siteUrl: string, title: string, description: string): string {
  const url = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
  return [
    meta('property', 'og:title', title.slice(0, 120)),
    meta('property', 'og:description', description.slice(0, 200)),
    meta('property', 'og:url', url),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:image', url + OG_IMAGE),
    meta('property', 'og:image:width', String(OG_W)),
    meta('property', 'og:image:height', String(OG_H)),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:image', url + OG_IMAGE),
  ].join('\n');
}

/** Put `tags` into the slot from withSocialSlot(), keeping the page's byte size. */
export function fillSocialSlot(html: string, tags: string): string {
  const [head, tail] = splitTail(html);
  const a = tail.lastIndexOf(OPEN);
  const b = tail.lastIndexOf(CLOSE);
  if (a < 0 || b < a) return html;
  const used = new TextEncoder().encode(tags).length;
  const slot = used <= SLOT_BYTES ? tags + ' '.repeat(SLOT_BYTES - used) : ' '.repeat(SLOT_BYTES);
  return head + tail.slice(0, a + OPEN.length) + slot + tail.slice(b);
}
