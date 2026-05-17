import { defineStore } from 'pinia';
import { ref } from 'vue';
import { usePlatformStore } from './platform';
import { usePostsStore } from './posts';
import { useStoriesStore } from './stories';

export const useLoginStore = defineStore('login', () => {
  const modalOpen = ref(false);
  const step = ref('login'); // 'login' | '2fa'
  const username = ref('');
  const password = ref('');
  const code = ref('');
  const errorMsg = ref('');
  const successMsg = ref('');
  const submitting = ref(false);

  const loggedIn = ref(false);
  const loggedUser = ref('');

  let pendingTfId = null;
  let pendingTfUsername = '';
  let pendingTfCsrf = '';

  function setLoggedIn(yes, uname = '') {
    loggedIn.value = yes;
    loggedUser.value = yes ? uname : '';
  }

  function reset() {
    username.value = '';
    password.value = '';
    code.value = '';
    errorMsg.value = '';
    successMsg.value = '';
    submitting.value = false;
    step.value = 'login';
    pendingTfId = null;
    pendingTfUsername = '';
    pendingTfCsrf = '';
  }

  function open() {
    reset();
    modalOpen.value = true;
  }
  function close() {
    modalOpen.value = false;
    reset();
  }

  async function submit() {
    if (!username.value.trim() || !password.value) {
      errorMsg.value = 'Please enter your username and password.';
      return;
    }
    submitting.value = true;
    errorMsg.value = '';
    successMsg.value = '';
    try {
      const res = await fetch('/api/ig-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.value.trim(), password: password.value }),
      });
      const data = await res.json();
      if (data.twoFactorRequired) {
        pendingTfId = data.twoFactorId;
        pendingTfUsername = username.value.trim();
        pendingTfCsrf = data.csrfToken || '';
        step.value = '2fa';
        code.value = '';
        return;
      }
      if (!res.ok) {
        errorMsg.value = data.error || 'Login failed.';
        return;
      }
      done(data.username || username.value.trim());
    } catch (_) {
      errorMsg.value = 'Connection failed. Is the server running?';
    } finally {
      submitting.value = false;
    }
  }

  async function submit2fa() {
    if (!code.value.trim()) {
      errorMsg.value = 'Please enter the verification code.';
      return;
    }
    submitting.value = true;
    errorMsg.value = '';
    try {
      const res = await fetch('/api/ig-login/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.value.trim(),
          twoFactorId: pendingTfId,
          username: pendingTfUsername,
          csrfToken: pendingTfCsrf,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        errorMsg.value = data.error || 'Verification failed.';
        return;
      }
      done(data.username || pendingTfUsername);
    } catch (_) {
      errorMsg.value = 'Connection failed.';
    } finally {
      submitting.value = false;
    }
  }

  function done(uname) {
    successMsg.value = 'Logged in as @' + uname;
    setLoggedIn(true, uname);
    setTimeout(() => {
      close();
      const platform = usePlatformStore();
      const posts = usePostsStore();
      const stories = useStoriesStore();
      if (posts.currentHandle && platform.current === 'instagram') {
        posts.fetchPosts(posts.currentHandle);
        stories.fetchStories(posts.currentHandle);
        stories.fetchHighlights(posts.currentHandle);
      }
    }, 1000);
  }

  async function logout() {
    try { await fetch('/api/ig-session', { method: 'DELETE' }); } catch (_) {}
    setLoggedIn(false);
  }

  async function checkSession() {
    try {
      const res = await fetch('/api/ig-session');
      const data = await res.json();
      if (data.loggedIn) setLoggedIn(true, data.username || data.userId);
    } catch (_) { /* ignore */ }
  }

  return {
    modalOpen, step, username, password, code, errorMsg, successMsg, submitting,
    loggedIn, loggedUser,
    open, close, submit, submit2fa, logout, checkSession, setLoggedIn, reset,
  };
});
