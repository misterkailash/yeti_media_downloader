// GET /api/ig-search?q=<query> — Instagram user autocomplete.
//
// Three-tier extraction (try in order, return first non-empty result):
//   1. topsearch  — public web search API. Works without a session for
//      most queries but has a low rate limit.
//   2. mobile     — i.instagram.com authed search. Higher rate limit but
//      needs a session.
//   3. direct     — treat the query as a literal username, scrape the
//      profile page. Last resort, single suggestion if the user exists.
import { httpsGet } from '../utils/http.js';
import { UA_DESKTOP_121, UA_DESKTOP_124, UA_INSTAGRAM_ANDROID } from '../utils/ua.js';
import { decodeHtmlEntities } from '../utils/util.js';
import { IG_SID, IG_COOKIE } from '../utils/session.js';

const mapSearchUser = (u) => ({
  username: u.username,
  full_name: u.full_name || '',
  profile_pic_url: u.profile_pic_url || '',
  is_verified: !!(u.is_verified || u.is_verified_badge),
  is_private: !!u.is_private,
});

async function topsearch(q) {
  const headers = {
    'User-Agent': UA_DESKTOP_124,
    'x-ig-app-id': '936619743392459',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.instagram.com/',
  };
  if (IG_SID()) headers['Cookie'] = IG_COOKIE();
  const r = await httpsGet(
    `https://www.instagram.com/web/search/topsearch/?context=user&count=8&query=${encodeURIComponent(q)}`,
    headers
  );
  if (r.status !== 200) throw new Error('topsearch status ' + r.status);
  const j = JSON.parse(r.body);
  return (j.users || []).map(({ user }) => mapSearchUser(user));
}

async function mobile(q) {
  if (!IG_SID()) throw new Error('no session');
  const r = await httpsGet(
    `https://i.instagram.com/api/v1/users/search/?q=${encodeURIComponent(q)}&count=8`,
    {
      'User-Agent': UA_INSTAGRAM_ANDROID,
      'x-ig-app-id': '567067343352427',
      'Cookie': IG_COOKIE(),
      'Accept-Language': 'en-US',
    }
  );
  if (r.status !== 200) throw new Error('mobile search status ' + r.status);
  const j = JSON.parse(r.body);
  return (j.users || []).map(mapSearchUser);
}

// Last resort: treat the query as a username and try fetching the profile.
// If it exists, return it as a single suggestion.
async function direct(q) {
  const handle = q.replace(/^@/, '');
  if (!/^[a-z0-9._]+$/i.test(handle)) return [];
  const r = await httpsGet(`https://www.instagram.com/${encodeURIComponent(handle)}/`);
  if (r.status !== 200) return [];
  if (r.body.includes('<title>Page Not Found')) return [];
  const ogImg = r.body.match(/og:image"[^>]*content="([^"]+)"/);
  const ogTitle = r.body.match(/og:title"[^>]*content="([^"]+)"/);
  if (!ogImg) return [];
  let fullName = '';
  if (ogTitle) {
    const t = decodeHtmlEntities(ogTitle[1]);
    const m = t.match(/^(.+?)\s*\(@/);
    fullName = m ? m[1].trim() : t.split('•')[0].trim();
  }
  return [{
    username: handle,
    full_name: fullName,
    profile_pic_url: decodeHtmlEntities(ogImg[1]),
    is_verified: false,
    is_private: false,
  }];
}

export default defineEventHandler(async (event) => {
  const q = String((getQuery(event).q || '')).trim();
  if (q.length < 1) return { users: [] };

  for (const [name, fn] of [['topsearch', topsearch], ['mobile', mobile], ['direct', direct]]) {
    try {
      const users = await fn(q);
      if (users && users.length) {
        return { users: users.slice(0, 8), via: name };
      }
    } catch (err) {
      console.warn(`[ig-search:${name}] ${err.message}`);
    }
  }
  return { users: [] };
});
