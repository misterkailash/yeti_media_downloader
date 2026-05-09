import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useLoginStore } from './login';

// Aggregates IG / FB / TT login state for the "Logged-in Sessions" page.
// IG keeps using its own login flow (password + 2FA via /api/ig-login,
// rendered as a small modal) because no third-party paste-cookie page
// exists. FB and TT both use the paste-cookie pattern via their respective
// /<platform>-auth pages, which postMessage back when login completes.
export const useSessionsStore = defineStore('sessions', () => {
  const fbLoggedIn = ref(false);
  const fbUser = ref('');
  const ttLoggedIn = ref(false);
  const ttUser = ref('');

  let messageBound = false;

  async function refreshFb() {
    try {
      const r = await fetch('/api/fb-session');
      const d = await r.json();
      fbLoggedIn.value = !!d.loggedIn;
      fbUser.value = d.username || '';
    } catch (_) { /* ignore */ }
  }

  async function refreshTt() {
    try {
      const r = await fetch('/api/tt-session');
      const d = await r.json();
      ttLoggedIn.value = !!d.loggedIn;
      ttUser.value = d.username || '';
    } catch (_) { /* ignore */ }
  }

  async function refreshAll() {
    const login = useLoginStore();
    await Promise.all([login.checkSession(), refreshFb(), refreshTt()]);
  }

  function bindAuthMessages() {
    if (messageBound) return;
    messageBound = true;
    window.addEventListener('message', (ev) => {
      if (!ev.data) return;
      if (ev.data.type === 'fb-login-success') refreshFb();
      if (ev.data.type === 'tt-login-success') refreshTt();
    });
  }

  // bindAuthMessages + refreshAll are exposed so SessionsPage can wire up
  // the postMessage listener and trigger an initial refresh on mount.

  function openFbAuth() {
    window.open('/fb-auth', 'fb-auth', 'width=520,height=720');
  }
  function openTtAuth() {
    window.open('/tt-auth', 'tt-auth', 'width=520,height=760');
  }
  function openIgAuth() {
    const login = useLoginStore();
    login.open();
  }

  async function logoutFb() {
    try { await fetch('/api/fb-session', { method: 'DELETE' }); } catch (_) {}
    fbLoggedIn.value = false;
    fbUser.value = '';
  }
  async function logoutTt() {
    try { await fetch('/api/tt-session', { method: 'DELETE' }); } catch (_) {}
    ttLoggedIn.value = false;
    ttUser.value = '';
  }
  async function logoutIg() {
    const login = useLoginStore();
    await login.logout();
  }

  return {
    fbLoggedIn, fbUser,
    ttLoggedIn, ttUser,
    refreshAll, bindAuthMessages,
    openIgAuth, openFbAuth, openTtAuth,
    logoutIg, logoutFb, logoutTt,
  };
});
