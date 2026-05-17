// Loads .env-derived auth defaults into the shared session module at boot.
// Only runs once per Nitro process. Used by lib/session.js: when YETI_DEV_MODE=1
// and DEV_DEFAULTS.{ig,fb,tt} are populated, every new browser session inherits
// the .env creds — so you don't have to re-paste cookies after each restart.
//
// Replaces the .env-reading block that used to live at the top of server.js.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDevDefaults, DEV_MODE, DEV_DEFAULTS } = require('../../lib/session.js');
const { httpsGet } = require('../../lib/http.js');
const { UA_INSTAGRAM_ANDROID } = require('../../lib/ua.js');
const { IG_APP_ID } = require('../../lib/ig.js');

function readEnv() {
  const devDefaults = { ig: null, fb: null, tt: null };
  try {
    const envText = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    const pick = (re) => { const m = envText.match(re); return m ? m[1].replace(/^['"]|['"]$/g, '') : ''; };
    if (DEV_MODE) {
      const igSid = pick(/^\s*IG_SESSIONID\s*=\s*(.+?)\s*$/m);
      if (igSid) devDefaults.ig = { sessionid: igSid, dsUserId: igSid.split('%3A')[0], username: '' };
      const fbCks = pick(/^\s*FB_COOKIES\s*=\s*(.+?)\s*$/m);
      if (fbCks) {
        const cUser = (fbCks.match(/c_user=(\d+)/) || [])[1] || '';
        devDefaults.fb = {
          cookies: fbCks, userId: cUser,
          username: pick(/^\s*FB_USERNAME\s*=\s*(.+?)\s*$/m),
          accessToken: pick(/^\s*FB_ACCESS_TOKEN\s*=\s*(.+?)\s*$/m),
        };
      }
      const ttCks = pick(/^\s*TT_COOKIES\s*=\s*(.+?)\s*$/m);
      if (ttCks) devDefaults.tt = { cookies: ttCks, userId: '', username: pick(/^\s*TT_USERNAME\s*=\s*(.+?)\s*$/m) };
    }
  } catch (_) { /* no .env file */ }
  return devDefaults;
}

// Best-effort hydration of the IG dev-default username so the UI shows
// "@whoami" instead of "Connected" for every new browser in dev mode.
async function hydrateIgUsername(ig) {
  if (!ig || !ig.sessionid || !ig.dsUserId) return;
  try {
    const r = await httpsGet(`https://i.instagram.com/api/v1/users/${ig.dsUserId}/info/`, {
      'User-Agent': UA_INSTAGRAM_ANDROID,
      'x-ig-app-id': IG_APP_ID,
      'Cookie': `sessionid=${ig.sessionid}; ds_user_id=${ig.dsUserId}`,
    });
    if (r.status === 200) {
      const j = JSON.parse(r.body);
      if (j.user && j.user.username) ig.username = j.user.username;
    }
  } catch (_) { /* username is cosmetic */ }
}

export default defineNitroPlugin(() => {
  const devDefaults = readEnv();
  initDevDefaults(devDefaults);

  if (DEV_MODE) {
    console.log('[auth] YETI_DEV_MODE=1 — .env credentials seed every new browser session. Do NOT enable in hosted/multi-user deployments.');
    console.log(devDefaults.ig ? `[auth] dev IG defaults loaded (user ${devDefaults.ig.dsUserId})` : '[auth] no dev IG defaults');
    console.log(devDefaults.fb ? `[auth] dev FB defaults loaded (user ${devDefaults.fb.userId})` : '[auth] no dev FB defaults');
    console.log(devDefaults.tt ? `[auth] dev TT defaults loaded${devDefaults.tt.username ? ` (@${devDefaults.tt.username})` : ''}` : '[auth] no dev TT defaults');
    if (DEV_DEFAULTS.ig) hydrateIgUsername(DEV_DEFAULTS.ig);
  } else {
    console.log('[auth] multi-user mode — each browser must log in via the UI. Set YETI_DEV_MODE=1 to load .env creds as personal defaults.');
  }
});
