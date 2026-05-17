<script setup>
import { ref, watch, nextTick, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useLoginStore } from '../stores/login';

const login = useLoginStore();
const { modalOpen, step, username, password, code, errorMsg, successMsg, submitting } = storeToRefs(login);

const userRef = ref(null);
const codeRef = ref(null);
const showPassword = ref(false);

const canSubmit = computed(() => !!username.value && !!password.value && !submitting.value);

watch(modalOpen, async (open) => {
  if (!open) return;
  showPassword.value = false;
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
    <div class="login-modal ig-modal" @click.stop>
      <div class="ig-brand">Instagram</div>

      <div v-if="step === 'login'" class="ig-form">
        <input
          ref="userRef"
          v-model="username"
          type="text"
          placeholder="Phone number, username, or email"
          autocomplete="username"
          class="ig-input"
        >
        <div class="ig-password">
          <input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="Password"
            autocomplete="current-password"
            class="ig-input"
            @keydown.enter="canSubmit && login.submit()"
          >
          <button
            v-if="password"
            type="button"
            class="ig-pw-toggle"
            @click="showPassword = !showPassword"
          >{{ showPassword ? 'Hide' : 'Show' }}</button>
        </div>
        <button
          class="ig-submit"
          :disabled="!canSubmit"
          @click="login.submit()"
        >
          {{ submitting ? 'Logging in…' : 'Log In' }}
        </button>

        <p class="ig-desc">
          Log in with your Instagram account to view posts from private profiles you follow.
        </p>

        <button class="ig-cancel" @click="login.close()">Cancel</button>
      </div>

      <div v-else class="ig-form">
        <p class="ig-2fa-desc">
          Enter the verification code from your authenticator app or SMS.
        </p>
        <input
          ref="codeRef"
          v-model="code"
          type="text"
          placeholder="6-digit code"
          maxlength="8"
          autocomplete="one-time-code"
          inputmode="numeric"
          class="ig-input ig-code"
          @keydown.enter="login.submit2fa()"
        >
        <button class="ig-submit" :disabled="submitting" @click="login.submit2fa()">
          {{ submitting ? 'Verifying…' : 'Verify' }}
        </button>
        <button class="ig-cancel" @click="login.close()">Cancel</button>
      </div>

      <div class="login-error" :class="{ visible: !!errorMsg }">{{ errorMsg }}</div>
      <div class="login-success" :class="{ visible: !!successMsg }">{{ successMsg }}</div>
    </div>
  </div>
</template>
