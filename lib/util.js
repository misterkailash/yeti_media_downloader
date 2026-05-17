function decodeHtmlEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return _; }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return _; }
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function formatCount(n) {
  if (n == null) return null;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString('en-US');
}

function parseOgDescription(desc) {
  // "673M Followers, 643 Following, 4,036 Posts - See Instagram photos..."
  const result = {};
  const followerMatch = desc.match(/([\d,.]+[MK]?)\s+Followers/i);
  const followingMatch = desc.match(/([\d,.]+[MK]?)\s+Following/i);
  const postsMatch = desc.match(/([\d,.]+[MK]?)\s+Posts/i);
  if (followerMatch) result.followers = followerMatch[1];
  if (followingMatch) result.following = followingMatch[1];
  if (postsMatch) result.posts = postsMatch[1];
  return result;
}

// Builds a Content-Disposition value that preserves the original filename
// (including Unicode, spaces, etc.) via RFC 5987 while also providing an
// ASCII fallback for legacy clients. Modern browsers and IDM read the
// filename* form preferentially.
function contentDispoAttachment(name, ext) {
  const raw = String(name || `download_${Date.now()}`);
  const ascii = raw.replace(/[^\x20-\x7e]/g, '_').replace(/[<>:"/\\|?*]/g, '_').slice(0, 100);
  const encoded = encodeURIComponent(raw).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encoded}.${ext}`;
}

module.exports = { decodeHtmlEntities, formatCount, parseOgDescription, contentDispoAttachment };
