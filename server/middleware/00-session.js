// Nitro session middleware — parses the yeti_session cookie (creates a
// fresh one if missing/malformed) and enters the AsyncLocalStorage context
// for the rest of the request. Helpers in lib/session.js (getIg/getFb/getTt
// and friends) then resolve the active session for every server/api/* handler.
import { resolveSession, sessionStorage, SESSION_TTL_MS } from '../utils/session.js';

const IS_PROD = process.env.NODE_ENV === 'production';

export default defineEventHandler((event) => {
  const cookieHeader = event.node.req.headers.cookie || '';
  const { session, token, isNew } = resolveSession(cookieHeader);
  if (isNew) {
    setCookie(event, 'yeti_session', token, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  }
  // enterWith (not run()) — the storage value persists through the rest of
  // this request's async chain so handlers can call getIg()/getFb()/getTt()
  // without threading the session through every signature.
  sessionStorage.enterWith(session);
});
