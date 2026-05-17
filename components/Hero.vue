<script setup>
import instagram from '../assets/instagram.png';
import facebook from '../assets/facebook.png';
import tiktok from '../assets/tiktok.png';
import threads from '../assets/threads.png';
import x from '../assets/x.png';
import youtube from '../assets/youtube.png';
import soundcloud from '../assets/soundcloud.png';
import reddit from '../assets/reddit.png';
import vsco from '../assets/vsco.png';
</script>

<template>
  <div class="hero">
    <div class="hero-content">
      <h2>Yeti Media Downloader</h2>
      <p>Just paste your favorite profile link or video URL and download it easily!</p>
    </div>
    <div class="hero-icons">
      <div class="h-icon"><img :src="instagram" alt="Instagram" width="22" height="22"></div>
      <div class="h-icon"><img :src="facebook" alt="Facebook" width="22" height="22"></div>
      <div class="h-icon"><img :src="youtube" alt="YouTube" width="22" height="22"></div>
      <div class="h-icon"><img :src="tiktok" alt="TikTok" width="22" height="22"></div>
      <div class="h-icon"><img :src="x" alt="X" width="22" height="22"></div>
      <div class="h-icon"><img :src="threads" alt="Threads" width="22" height="22"></div>
      <div class="h-icon"><img :src="soundcloud" alt="SoundCloud" width="22" height="22"></div>
      <div class="h-icon"><img :src="reddit" alt="Reddit" width="22" height="22"></div>
      <div class="h-icon"><img :src="vsco" alt="VSCO" width="22" height="22"></div>
    </div>
  </div>
</template>
