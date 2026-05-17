// GET /api/fb-session — Facebook login status for the current browser.
// Reads from the shared session via lib/session helpers; see ig-session.get.js
// for the cross-runtime session-sharing notes.
import { FB_CKS, FB_UNAME, FB_UID } from '../utils/session.js';

export default defineEventHandler(() => {
  return {
    loggedIn: !!FB_CKS(),
    username: FB_UNAME() || null,
    userId: FB_UID() || null,
  };
});
