// Facebook-specific helpers — URL upgrades, profile-pic ranking, browser
// header crafting, og:description parsing. Used by:
//   - /api/fb-profile/:username  (server/api/fb-profile/[username].get.js)
//   - server.js's FB login validation flow
//   - server.js's FB video extraction flow
const { httpHead } = require('./http');
const { UA_DESKTOP_124 } = require('./ua');

// HEAD-probes a candidate image URL and returns true if FB actually
// serves an image. Used to catch broken `lookaside.fbsbx.com` URLs (some
// FB profiles return an HTML "view in app" stub there instead of the
// JPEG, even with the crawler UA) before we hand the URL to the frontend.
function isUsableImageUrl(url) {
  return httpHead(url, {
    'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  }).then(r => r.contentType.startsWith('image/'));
}

// Strip the `ctp=s240x240` thumbnail-crop param from a scontent.fbcdn.net
// URL so FB serves the full source canvas (typically 2048×2048 ~ 377KB)
// instead of a 240px thumbnail (~10KB). The remaining `stp` (transform
// spec) plus `oh`/`oe` (signature) stay valid without ctp; FB just falls
// back to the source dimensions defined by `cstp`.
function upgradeFbScontentUrl(url) {
  if (!url || !/scontent[^/]*fbcdn\.net/.test(url)) return url;
  return url
    .replace(/[?&]ctp=s\d+x\d+/i, '')
    .replace(/\?&/, '?')
    .replace(/&&+/g, '&');
}

// Scans an FB authenticated HTML response for every scontent.fbcdn.net
// profile-picture URL and returns the one with the largest source canvas.
// FB embeds multiple variants in the SPA shell (`profile_picture` is a
// 50–100px chat-bubble version; `profilePicLarge`/`profilePictureLarge`
// hold the 720px+ version; the largest variant uses `cstp=mx2043x2048`).
// Picking by name is fragile because FB reorders keys; picking by
// declared canvas is robust and survives schema rotations.
function pickLargestFbPicUrl(html) {
  if (!html) return null;
  // FB's inline JSON escapes slashes as \/, which would break a simple URL
  // regex. Unescape first, then scan. We also collapse the &amp; entity
  // form of `&` that shows up in HTML-escaped variants.
  const text = html.replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const urls = new Set();
  // Profile pic buckets live under t1.30497 (current) and t39.30808
  // (legacy / linked); the static asset bucket is rsrc.php which we exclude.
  const re = /https?:\/\/scontent[^"<>'\s\\]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"<>'\s\\]*)?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[0];
    if (/rsrc\.php/.test(url)) continue;
    if (!/t\d+\.\d+/.test(url)) continue;
    urls.add(url);
  }
  if (!urls.size) return null;
  const scored = [...urls].map(u => {
    const cstp = u.match(/[?&]cstp=mx(\d+)x(\d+)/);
    if (cstp) return { url: u, area: Number(cstp[1]) * Number(cstp[2]) };
    const ctp = u.match(/[?&]ctp=s(\d+)x(\d+)/);
    if (ctp) return { url: u, area: Number(ctp[1]) * Number(ctp[2]) };
    const p = u.match(/[\/_](?:p|s|c)(\d+)x(\d+)/);
    if (p) return { url: u, area: Number(p[1]) * Number(p[2]) };
    return { url: u, area: 0 };
  });
  scored.sort((a, b) => b.area - a.area);
  console.log(`[fb-profile] picked pic ${scored[0].area}px² from ${scored.length} candidates (top: ${scored.slice(0, 3).map(s => s.area).join(', ')})`);
  return scored[0].url;
}

// Builds the full "real browser" header set FB's anti-abuse layer expects.
// Without these, FB returns 400 Bad Request to authenticated fetches even
// when cookies + UA match — Sec-Fetch-* / sec-ch-ua-* are the discriminator
// between "Chrome top-level navigation" and "scripted fetch".
function fbBrowserHeaders(userAgent) {
  const ua = userAgent || UA_DESKTOP_124;
  const headers = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
    'Upgrade-Insecure-Requests': '1',
  };
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  if (chromeMatch && !/Edg\/|OPR\//.test(ua)) {
    const ver = chromeMatch[1];
    headers['sec-ch-ua'] = `"Chromium";v="${ver}", "Google Chrome";v="${ver}", "Not?A_Brand";v="99"`;
    headers['sec-ch-ua-mobile'] = /Mobile|Android/.test(ua) ? '?1' : '?0';
    let platform = '"Windows"';
    if (/Macintosh|Mac OS X/.test(ua)) platform = '"macOS"';
    else if (/Android/.test(ua)) platform = '"Android"';
    else if (/Linux/.test(ua)) platform = '"Linux"';
    else if (/iPhone|iPad/.test(ua)) platform = '"iOS"';
    headers['sec-ch-ua-platform'] = platform;
  }
  return headers;
}

// Parses "Cristiano Ronaldo. 171,559,776 likes · 1,822,617 talking about this. ..."
function parseFbDescription(desc) {
  const result = {};
  const likesMatch = desc.match(/([\d,.]+)\s+(?:likes|followers|people\s+follow)/i);
  const talkingMatch = desc.match(/([\d,.]+)\s+talking about this/i);
  if (likesMatch) result.followers = likesMatch[1];
  if (talkingMatch) result.talking = talkingMatch[1];
  return result;
}

module.exports = {
  isUsableImageUrl,
  upgradeFbScontentUrl,
  pickLargestFbPicUrl,
  fbBrowserHeaders,
  parseFbDescription,
};
