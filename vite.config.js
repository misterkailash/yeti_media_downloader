import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    open: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/fb-auth': 'http://localhost:3000',
    },
  },
});
