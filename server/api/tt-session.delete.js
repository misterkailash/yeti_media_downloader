// DELETE /api/tt-session — clear the TikTok session for this browser.
import { setTt } from '../utils/session.js';

export default defineEventHandler(() => {
  setTt(null);
  console.log('[tt-auth] logged out');
  return { success: true };
});
