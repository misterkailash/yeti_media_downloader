<script setup>
import { storeToRefs } from 'pinia';
import { useUiStore } from '../stores/ui';
import { useLoginStore } from '../stores/login';

const ui = useUiStore();
const login = useLoginStore();
const { authWarn } = storeToRefs(ui);

function openLogin() {
  ui.hideAuthWarn();
  login.open();
}
</script>

<template>
  <div class="auth-warn" :class="{ visible: authWarn.visible }">
    <span class="aw-msg">
      <template v-if="authWarn.html">
        {{ authWarn.html.prefix }}
        <a
          :href="authWarn.html.link.href"
          target="_blank"
          rel="noopener"
          style="color:var(--accent);text-decoration:underline;font-weight:500"
        >{{ authWarn.html.link.text }}</a>
        {{ authWarn.html.suffix }}
      </template>
      <template v-else>{{ authWarn.message }}</template>
    </span>
    <button v-show="authWarn.showLogin" class="aw-btn" @click="openLogin">Log in</button>
    <button class="aw-close" aria-label="Dismiss" @click="ui.hideAuthWarn()">&times;</button>
  </div>
</template>
