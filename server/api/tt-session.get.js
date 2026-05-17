// GET /api/tt-session — TikTok login status for the current browser.
// Reads from the shared session via lib/session helpers; see ig-session.get.js
// for the cross-runtime session-sharing notes.
import { TT_CKS, TT_UNAME, TT_UID } from '../utils/session.js';

export default defineEventHandler(() => {
  return {
    loggedIn: !!TT_CKS(),
    username: TT_UNAME() || null,
    userId: TT_UID() || null,
  };
});
