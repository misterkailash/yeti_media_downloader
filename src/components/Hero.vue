<script setup>
import instagram from '../assets/instagram.png';
import facebook from '../assets/facebook.png';
import tiktok from '../assets/tiktok.png';
import threads from '../assets/threads.png';
</script>

<template>
  <div class="hero">
    <h2>Yeti Media Downloader</h2>
    <p>Just paste your favorite profile link or video URL and download it easily!</p>
    <div class="hero-icons">
      <div class="h-icon"><img :src="instagram" alt="Instagram" width="28" height="28"></div>
      <div class="h-icon"><img :src="facebook" alt="Facebook" width="28" height="28"></div>
      <div class="h-icon"><img :src="tiktok" alt="TikTok" width="28" height="28"></div>
      <div class="h-icon"><img :src="threads" alt="Threads" width="28" height="28"></div>
    </div>
  </div>
</template>
