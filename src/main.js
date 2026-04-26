import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './assets/styles.css';
import logo from './assets/logo.png';

const favicon = document.querySelector('link[rel="icon"]') || document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = logo;
if (!favicon.parentNode) document.head.appendChild(favicon);

const app = createApp(App);
app.use(createPinia());
app.mount('#app');
