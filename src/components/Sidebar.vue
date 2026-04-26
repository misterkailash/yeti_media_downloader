<script setup>
import { storeToRefs } from 'pinia';
import { useUiStore } from '../stores/ui';
import { useLoginStore } from '../stores/login';
import logo from '../assets/logo.png';

const ui = useUiStore();
const login = useLoginStore();
const { sidebarOpen } = storeToRefs(ui);
const { loggedIn, loggedUser } = storeToRefs(login);
</script>

<template>
  <button class="menu-toggle" type="button" @click="ui.toggleSidebar()">
    <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round"/></svg>
  </button>
  <div class="sidebar-overlay" :class="{ open: sidebarOpen }" @click="ui.closeSidebar()"></div>

  <aside class="sidebar" :class="{ open: sidebarOpen }">
    <div class="sidebar-logo">
      <img :src="logo" alt="Yeti" class="logo-icon">
      <div class="logo-text">
        Yeti Media<br>Downloader
        <span>by Kailash</span>
      </div>
    </div>

    <nav class="sidebar-nav">
      <a class="active">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>
        Save via Link
      </a>
      <a>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/>
        </svg>
        Downloads
      </a>
    </nav>

    <div class="sidebar-bottom">
      <a v-show="!loggedIn" style="cursor:pointer" @click="login.open()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        Instagram Login
      </a>
      <div v-show="loggedIn" class="login-status">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:2px">
          <rect x="2" y="2" width="20" height="20" rx="5"/>
          <circle cx="12" cy="12" r="5"/>
          <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/>
        </svg>
        <span class="logged-user">@{{ loggedUser }}</span>
        <button @click="login.logout()">Logout</button>
      </div>
      <a>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        Rate Us
      </a>
      <a>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        Support
      </a>
      <a>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        Privacy Policy
      </a>
    </div>
  </aside>
</template>
