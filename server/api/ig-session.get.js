// GET /api/ig-session — Instagram login status for the current browser.
// Reads from the shared session via lib/session helpers. Works because
// server/middleware/00-session.js called sessionStorage.enterWith() before
// this handler runs, so IG_SID()/IG_UNAME()/IG_DS_ID() see the right
// per-session record.
import { IG_SID, IG_UNAME, IG_DS_ID } from '../utils/session.js';

export default defineEventHandler(() => {
  return {
    loggedIn: !!IG_SID(),
    username: IG_UNAME() || null,
    userId: IG_DS_ID() || null,
  };
});
