// DELETE /api/fb-session — clear the Facebook session for this browser.
import { setFb } from '../utils/session.js';

export default defineEventHandler(() => {
  setFb(null);
  console.log('[fb-auth] logged out');
  return { success: true };
});
