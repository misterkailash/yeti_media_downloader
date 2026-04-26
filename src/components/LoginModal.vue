<script setup>
import { ref, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useLoginStore } from '../stores/login';

const login = useLoginStore();
const { modalOpen, step, username, password, code, errorMsg, successMsg, submitting } = storeToRefs(login);

const userRef = ref(null);
const codeRef = ref(null);

watch(modalOpen, async (open) => {
  if (!open) return;
  await nextTick();
  userRef.value?.focus();
});
watch(step, async (s) => {
  if (s !== '2fa') return;
  await nextTick();
  codeRef.value?.focus();
});

function closeIfBackdrop(e) {
  if (e.target === e.currentTarget) login.close();
}
</script>

<template>
  <div class="login-modal-overlay" :class="{ visible: modalOpen }" @click="closeIfBackdrop">
    <div class="login-modal" @click.stop>
      <h3>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        Instagram Login
      </h3>
      <p class="login-desc">Log in with your Instagram account to view posts from private profiles you follow.</p>

      <div v-if="step === 'login'">
        <div class="login-input-wrap" style="flex-direction:column;gap:10px">
          <input
            ref="userRef"
            v-model="username"
            type="text"
            placeholder="Instagram username"
            autocomplete="username"
          >
          <input
            v-model="password"
            type="password"
            placeholder="Password"
            autocomplete="current-password"
            @keydown.enter="login.submit()"
          >
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
          <button class="login-submit" :disabled="submitting" @click="login.submit()">
            {{ submitting ? 'Logging in...' : 'Log In' }}
          </button>
          <button class="login-cancel" @click="login.close()">Cancel</button>
        </div>
      </div>

      <div v-else>
        <p class="login-desc" style="margin-top:8px">Enter the verification code from your authenticator app or SMS.</p>
        <div class="login-input-wrap">
          <input
            ref="codeRef"
            v-model="code"
            type="text"
            placeholder="6-digit code"
            maxlength="8"
            autocomplete="one-time-code"
            inputmode="numeric"
            @keydown.enter="login.submit2fa()"
          >
          <button class="login-submit" :disabled="submitting" @click="login.submit2fa()">
            {{ submitting ? 'Verifying...' : 'Verify' }}
          </button>
        </div>
        <div style="margin-top:8px">
          <button class="login-cancel" @click="login.close()">Cancel</button>
        </div>
      </div>

      <div class="login-error" :class="{ visible: !!errorMsg }">{{ errorMsg }}</div>
      <div class="login-success" :class="{ visible: !!successMsg }">{{ successMsg }}</div>
    </div>
  </div>
</template>
