import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
  const sidebarOpen = ref(false);
  const loading = ref(false);
  const errorMessage = ref('');
  const authWarn = ref({ visible: false, message: '', showLogin: false, html: null });

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value;
  }
  function closeSidebar() {
    sidebarOpen.value = false;
  }
  function showError(msg) {
    errorMessage.value = msg;
  }
  function clearError() {
    errorMessage.value = '';
  }
  function showAuthWarn(message, { showLogin = false, html = null } = {}) {
    authWarn.value = { visible: true, message, showLogin, html };
  }
  function hideAuthWarn() {
    authWarn.value = { visible: false, message: '', showLogin: false, html: null };
  }

  return {
    sidebarOpen, loading, errorMessage, authWarn,
    toggleSidebar, closeSidebar,
    showError, clearError,
    showAuthWarn, hideAuthWarn,
  };
});
