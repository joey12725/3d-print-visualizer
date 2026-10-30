import { describe, expect, it } from 'vitest';
import { fillSocialSlot, socialTags, stripSocialMeta, withSocialSlot } from '../src/lib/share/social';

// the end of the main site's page as here.now serves it (the bundle is the inline script)
const served = `<head><script type="module">const t = '<meta property="og:x" content="kept">';</script>
<style>a{}</style>
  <meta property="og:title" content="Print Preview" />
<meta property="og:image" content="https://here.now/og/sleek-nirvana-3mxh.jpg" />
<meta name="twitter:image" content="https://here.now/og/sleek-nirvana-3mxh.jpg" />
<meta name="twitter:card" content="summary_large_image" /></head>
  <body>`;
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('share link previews', () => {
  it("drops the main site's og:/twitter: tags but not lookalikes in the bundle", () => {
    const out = stripSocialMeta(served);
    expect(out).not.toContain('sleek-nirvana');
    expect(out).toContain(`'<meta property="og:x" content="kept">'`);
    expect(out).toContain('<style>a{}</style>\n  </head>');
  });

  it("fills the slot with the link's own image without changing the byte size", () => {
    const slotted = withSocialSlot(served);
    const tags = socialTags('https://mineral-garnet-d59j.here.now/', 'Katze “mask” <v2> · ü', 'Shared 3D print preview');
    const filled = fillSocialSlot(slotted, tags);
    expect(bytes(filled)).toBe(bytes(slotted));
    expect(filled).toContain('<meta property="og:image" content="https://mineral-garnet-d59j.here.now/og.jpg" />');
    expect(filled).toContain('content="Katze “mask” &lt;v2&gt; · ü"');
    expect(filled).not.toContain('sleek-nirvana');
  });
});
