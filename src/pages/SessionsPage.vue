<script setup>
import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useSessionsStore } from '../stores/sessions';
import { useLoginStore } from '../stores/login';
import instagramIcon from '../assets/instagram.png';
import facebookIcon from '../assets/facebook.png';
import tiktokIcon from '../assets/tiktok.png';

const sessions = useSessionsStore();
const login = useLoginStore();
const { fbLoggedIn, fbUser, ttLoggedIn, ttUser } = storeToRefs(sessions);
const { loggedIn: igLoggedIn, loggedUser: igUser } = storeToRefs(login);

onMounted(() => {
  sessions.bindAuthMessages();
  sessions.refreshAll();
});

const rows = computed(() => [
  {
    id: 'instagram',
    label: 'Instagram',
    icon: instagramIcon,
    desc: 'Sign in with username + password (2FA supported) to view private profiles you follow.',
    loggedIn: igLoggedIn.value,
    user: igUser.value,
    onLogin: () => sessions.openIgAuth(),
    onLogout: () => sessions.logoutIg(),
  },
  {
    id: 'facebook',
    label: 'Facebook',
    icon: facebookIcon,
    desc: 'Paste c_user + xs cookies from your browser to access videos that require login.',
    loggedIn: fbLoggedIn.value,
    user: fbUser.value,
    onLogin: () => sessions.openFbAuth(),
    onLogout: () => sessions.logoutFb(),
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    icon: tiktokIcon,
    desc: 'Paste sessionid + tt-target-idc cookies to download private or age-restricted videos.',
    loggedIn: ttLoggedIn.value,
    user: ttUser.value,
    onLogin: () => sessions.openTtAuth(),
    onLogout: () => sessions.logoutTt(),
  },
]);
</script>

<template>
  <div class="sessions-page">
    <div class="sessions-header">
      <h1>Logged-in Sessions</h1>
      <p class="sessions-sub">Manage account sessions used for downloading private posts.</p>
    </div>

    <div class="session-rows">
      <div v-for="r in rows" :key="r.id" class="session-row">
        <img :src="r.icon" :alt="r.label" class="session-icon">
        <div class="session-meta">
          <div class="session-head">
            <span class="session-name">{{ r.label }}</span>
            <span class="session-status" :class="{ on: r.loggedIn }">
              <span class="dot"></span>
              {{ r.loggedIn ? (r.user ? '@' + r.user : 'Connected') : 'Not connected' }}
            </span>
          </div>
          <div class="session-desc">{{ r.desc }}</div>
        </div>
        <div class="session-actions">
          <button v-if="!r.loggedIn" class="login-submit session-btn" @click="r.onLogin()">Log in</button>
          <button v-else class="login-cancel session-btn ghost" @click="r.onLogout()">Log out</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sessions-page {
  max-width: 760px;
  margin: 0 auto;
  padding: 40px 24px 80px;
}
.sessions-header { margin-bottom: 28px; }
.sessions-header h1 {
  font-size: 1.8rem;
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--text);
}
.sessions-sub {
  font-size: 0.88rem;
  color: var(--text-dim);
  line-height: 1.5;
}
.session-rows { display: flex; flex-direction: column; gap: 14px; }
.session-row {
  display: flex; align-items: center; gap: 16px;
  padding: 18px;
  border: 1.5px solid var(--border); border-radius: 14px;
  background: var(--surface);
  transition: border-color 0.15s ease, transform 0.15s ease;
}
.session-row:hover { border-color: var(--accent); }
.session-icon {
  width: 44px; height: 44px; border-radius: 10px;
  object-fit: cover; flex-shrink: 0;
}
.session-meta { flex: 1; min-width: 0; }
.session-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 6px;
}
.session-name { font-weight: 700; font-size: 1rem; color: var(--text); }
.session-status {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 0.74rem; color: var(--text-dim);
  padding: 3px 10px; border-radius: 999px;
  background: var(--bg); border: 1px solid var(--border);
}
.session-status.on { color: #15803d; border-color: #bbf7d0; background: #f0fdf4; }
.session-status .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-dim);
}
.session-status.on .dot { background: #22c55e; }
.session-desc {
  font-size: 0.8rem; color: var(--text-dim); line-height: 1.5;
}
.session-actions { flex-shrink: 0; }
.session-btn {
  padding: 9px 18px; font-size: 0.82rem;
}
.session-btn.ghost {
  background: transparent;
  border: 1.5px solid var(--border);
  color: var(--text);
  border-radius: 10px;
  font-weight: 600;
}
.session-btn.ghost:hover { border-color: var(--accent); color: var(--accent); }
@media (max-width: 600px) {
  .sessions-page { padding: 24px 16px 60px; }
  .session-row { flex-wrap: wrap; }
  .session-actions { width: 100%; }
  .session-btn { width: 100%; }
}
</style>
