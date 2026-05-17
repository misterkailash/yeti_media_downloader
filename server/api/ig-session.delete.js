// DELETE /api/ig-session — log out of Instagram for the current browser.
// Clears the IG session record via invalidateIgSession (same helper used
// when IG rejects the saved sessionid mid-request).
import { invalidateIgSession } from '../utils/ig.js';

export default defineEventHandler(() => {
  invalidateIgSession('manual-logout');
  return { success: true };
});
