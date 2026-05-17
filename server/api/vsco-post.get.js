// GET /api/vsco-post?url=<vsco-post-url>
//
// VSCO is behind Cloudflare and blocks raw Node fetches. We route through
// Jina Reader (free headless-Chrome proxy) which solves the challenge.
// Default Jina output is markdown — for an image-only page, the image is
// emitted as ![alt](url) which we extract directly. Falls back to HTML if
// markdown doesn't yield an image URL.
//
// Native Nitro port of the same endpoint that used to live in server.js
// (around line 2505 before the rearchitecture). The Express bridge in
// server/middleware/express.js is wired to skip this path so this handler
// receives the request instead.
import https from 'node:https';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function decodeHtmlEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => { try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, dec) => { try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return _; } })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function fetchViaJina(postUrl, format) {
  return new Promise((resolve) => {
    const headers = {
      'User-Agent': UA,
      'Accept': 'text/markdown, text/html, */*',
    };
    if (format) headers['X-Return-Format'] = format;
    const req = https.get({
      host: 'r.jina.ai',
      path: '/' + postUrl,
      headers,
      rejectUnauthorized: false,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        console.log(`[vsco-post-jina] format=${format || 'markdown'} → ${res.statusCode} (${body.length}b)`);
        if (res.statusCode === 200 && body.length > 100) resolve(body);
        else resolve(null);
      });
    });
    req.on('error', (e) => { console.warn(`[vsco-post-jina] ${e.message}`); resolve(null); });
    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
  });
}

function extractImage(body) {
  let m = body.match(/!\[[^\]]*\]\((https?:\/\/im\.vsco\.co\/[^)\s]+)\)/);
  if (m) return m[1];
  m = body.match(/og:image"[^>]*content="([^"]+)"/);
  if (m) return decodeHtmlEntities(m[1]);
  m = body.match(/<img[^>]*src="(https?:\/\/im\.vsco\.co\/[^"]+)"/);
  if (m) return m[1];
  m = body.match(/https?:\/\/im\.vsco\.co\/[^"'\s)<>]+\.(?:jpg|jpeg|png|webp)/i);
  if (m) return m[0];
  m = body.match(/https?:\/\/im\.vsco\.co\/[^"'\s)<>]+/);
  if (m) return m[0];
  return '';
}

export default defineEventHandler(async (event) => {
  const { url: rawUrl } = getQuery(event);

  if (!rawUrl || typeof rawUrl !== 'string' || !/^https?:\/\/(www\.)?vsco\.co\//i.test(rawUrl)) {
    setResponseStatus(event, 400);
    return { error: 'Please paste a valid VSCO post URL' };
  }

  try {
    const urlMatch = rawUrl.match(/vsco\.co\/([^/]+)\/(?:media\/)?([a-f0-9]{20,}|\d{6,})/i);
    const author = urlMatch ? urlMatch[1] : '';
    const postId = urlMatch ? urlMatch[2] : '';

    // Markdown first (smallest, has the image as ![alt](url))
    let body = await fetchViaJina(rawUrl);
    let imageUrl = body ? extractImage(body) : '';

    // Fallback: HTML format
    if (!imageUrl) {
      body = await fetchViaJina(rawUrl, 'html');
      if (body) imageUrl = extractImage(body);
    }

    if (!imageUrl) {
      if (body) console.log(`[vsco-post] preview:\n${body.slice(0, 800)}`);
      setResponseStatus(event, 404);
      return { error: 'Could not find image in VSCO post' };
    }

    let title = '';
    let description = '';
    const ogTitleMatch = body.match(/og:title"[^>]*content="([^"]+)"/);
    if (ogTitleMatch) {
      title = decodeHtmlEntities(ogTitleMatch[1]).replace(/\s*[\|·•].*$/, '').trim();
    } else {
      const h1 = body.match(/^#\s+(.+)$/m);
      if (h1) title = h1[1].trim();
    }
    const ogDescMatch = body.match(/og:description"[^>]*content="([^"]+)"/);
    if (ogDescMatch) description = decodeHtmlEntities(ogDescMatch[1]).trim();

    if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
    imageUrl = imageUrl.replace(/\?.*$/, '');

    console.log(`[vsco-post] ${author}/${postId} → ${imageUrl}`);
    return {
      id: postId,
      author,
      title: title || author || '',
      description,
      imageUrl,
    };
  } catch (err) {
    console.error('[vsco-post]', err);
    setResponseStatus(event, 500);
    return { error: 'Failed to fetch post' };
  }
});
