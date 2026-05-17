// ESM wrapper around lib/session.js. Nitro endpoints import from here for
// clean ESM syntax; server.js (CJS) requires lib/session.js directly. Both
// sides hit the same module instance via Node's require cache, so the
// sessions Map and AsyncLocalStorage are genuinely shared.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../../lib/session.js');

export const sessionStorage = lib.sessionStorage;
export const sessions = lib.sessions;
export const SESSION_TTL_MS = lib.SESSION_TTL_MS;
export const DEV_MODE = lib.DEV_MODE;
export const resolveSession = lib.resolveSession;
export const currentSession = lib.currentSession;
export const getIg = lib.getIg;
export const getFb = lib.getFb;
export const getTt = lib.getTt;
export const setIg = lib.setIg;
export const setFb = lib.setFb;
export const setTt = lib.setTt;
export const IG_SID = lib.IG_SID;
export const IG_DS_ID = lib.IG_DS_ID;
export const IG_UNAME = lib.IG_UNAME;
export const IG_COOKIE = lib.IG_COOKIE;
export const FB_CKS = lib.FB_CKS;
export const FB_UID = lib.FB_UID;
export const FB_ATOKEN = lib.FB_ATOKEN;
export const FB_UNAME = lib.FB_UNAME;
export const TT_CKS = lib.TT_CKS;
export const TT_UID = lib.TT_UID;
export const TT_UNAME = lib.TT_UNAME;
