// Static sitemap of the public-facing routes. Hand-maintained because
// the route set is small and fixed; bump when adding a new platform or
// public page.
const ROUTES = [
  '/',
  '/instagram',
  '/instagram-post',
  '/facebook',
  '/facebook-videos',
  '/threads',
  '/vsco',
  '/tiktok',
  '/tiktok-videos',
  '/x',
  '/youtube',
  '/soundcloud',
  '/reddit',
  '/faq',
  '/feedback',
  '/privacy',
];

export default defineEventHandler((event) => {
  const host = getRequestHeader(event, 'host') || 'localhost:3000';
  const proto = getRequestHeader(event, 'x-forwarded-proto') || 'https';
  const base = `${proto}://${host}`;
  const today = new Date().toISOString().slice(0, 10);

  const urls = ROUTES.map((path) => {
    const priority = path === '/' ? '1.0' : path.startsWith('/faq') || path.startsWith('/feedback') || path.startsWith('/privacy') ? '0.4' : '0.8';
    return `  <url><loc>${base}${path}</loc><lastmod>${today}</lastmod><priority>${priority}</priority></url>`;
  }).join('\n');

  setHeader(event, 'content-type', 'application/xml; charset=utf-8');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
});
