// Shared session storage. Source of truth for the per-browser `yeti_session`
// model — every Nitro endpoint resolves the active session via this module
// and the matching middleware in server/middleware/00-session.js.
//
// Auth credentials live ONLY in memory, keyed by an HttpOnly `yeti_session`
// cookie unique to each browser. Restarting the server clears all sessions
// (users must log in again). Credentials are never written to disk — in
// hosted/multi-user deployments this prevents one user's login from leaking
// to other browsers.
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const sessionStorage = new AsyncLocalStorage();
const sessions = new Map();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEV_MODE = ['1', 'true', 'yes'].includes(String(process.env.YETI_DEV_MODE || '').toLowerCase());

// Mutable — populated by initDevDefaults() once the caller has parsed .env.
// In DEV mode, these get shallow-copied into every fresh session so a
// single-developer setup doesn't need to log in through the UI every time.
// In normal/multi-user mode this stays null and is ignored.
const DEV_DEFAULTS = { ig: null, fb: null, tt: null };

function initDevDefaults({ ig = null, fb = null, tt = null } = {}) {
  DEV_DEFAULTS.ig = ig;
  DEV_DEFAULTS.fb = fb;
  DEV_DEFAULTS.tt = tt;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(/;\s*/).forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function newSessionRecord() {
  // Shallow-copy DEV_DEFAULTS so per-session mutations (login/logout) don't
  // leak back into other browsers' bootstrapped sessions.
  return {
    ig: DEV_MODE && DEV_DEFAULTS.ig ? { ...DEV_DEFAULTS.ig } : null,
    fb: DEV_MODE && DEV_DEFAULTS.fb ? { ...DEV_DEFAULTS.fb } : null,
    tt: DEV_MODE && DEV_DEFAULTS.tt ? { ...DEV_DEFAULTS.tt } : null,
    lastSeen: Date.now(),
  };
}

// Given the raw `Cookie:` request header, return the matching session record
// (creating one if missing or if the token is malformed) plus the token and a
// flag indicating whether the caller should issue a Set-Cookie response
// header. Used by both the Express session middleware and the Nitro session
// middleware so the cookie-handling logic exists in exactly one place.
function resolveSession(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  let token = cookies.yeti_session;
  let isNew = false;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = crypto.randomBytes(32).toString('hex');
    isNew = true;
  }
  let session = sessions.get(token);
  if (!session) {
    session = newSessionRecord();
    sessions.set(token, session);
  }
  session.lastSeen = Date.now();
  return { session, token, isNew };
}

function currentSession() { return sessionStorage.getStore(); }
function getIg() { const s = currentSession(); return s ? s.ig : null; }
function getFb() { const s = currentSession(); return s ? s.fb : null; }
function getTt() { const s = currentSession(); return s ? s.tt : null; }
function setIg(v) { const s = currentSession(); if (s) s.ig = v; }
function setFb(v) { const s = currentSession(); if (s) s.fb = v; }
function setTt(v) { const s = currentSession(); if (s) s.tt = v; }

// Compact getters. Return empty strings (not null) so existing falsy/truthy
// and string-interpolation patterns work without `?.` + `||` everywhere.
const IG_SID    = () => getIg()?.sessionid   || '';
const IG_DS_ID  = () => getIg()?.dsUserId    || '';
const IG_UNAME  = () => getIg()?.username    || '';
// Full cookie string captured during login (csrftoken, mid, ig_did, rur,
// shbid, shbts plus sessionid/ds_user_id). Falls back to the minimal pair
// for sessions seeded from .env (which only carries sessionid).
const IG_COOKIE = () => getIg()?.cookieStr   || (getIg() ? `sessionid=${IG_SID()}; ds_user_id=${IG_DS_ID()}` : '');
const FB_CKS    = () => getFb()?.cookies     || '';
const FB_UID    = () => getFb()?.userId      || '';
const FB_ATOKEN = () => getFb()?.accessToken || '';
const FB_UNAME  = () => getFb()?.username    || '';
const TT_CKS    = () => getTt()?.cookies     || '';
const TT_UID    = () => getTt()?.userId      || '';
const TT_UNAME  = () => getTt()?.username    || '';

// Periodic sweep of stale sessions. Sessions untouched for SESSION_TTL_MS
// are dropped from the map so a long-running server doesn't grow unbounded.
// Auto-starts at module load (idempotent — Node's require cache ensures
// this file only loads once per process).
//
// Also unlinks any IG cookie file the session left behind in tmpdir
// (written by lib/ig.js:writeIgCookieFile when yt-dlp needed it).
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [k, v] of sessions) {
    if (v.lastSeen < cutoff) {
      if (v.ig && v.ig.cookieFile) fs.unlink(v.ig.cookieFile, () => {});
      sessions.delete(k);
    }
  }
}, 60 * 60 * 1000).unref();

module.exports = {
  sessionStorage,
  sessions,
  SESSION_TTL_MS,
  DEV_MODE,
  DEV_DEFAULTS,
  initDevDefaults,
  parseCookies,
  newSessionRecord,
  resolveSession,
  currentSession,
  getIg, getFb, getTt,
  setIg, setFb, setTt,
  IG_SID, IG_DS_ID, IG_UNAME, IG_COOKIE,
  FB_CKS, FB_UID, FB_ATOKEN, FB_UNAME,
  TT_CKS, TT_UID, TT_UNAME,
};
