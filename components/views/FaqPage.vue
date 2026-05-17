<script setup>
import { ref } from 'vue';

const items = [
  {
    q: 'What is Yeti Media Downloader?',
    a: 'Yeti is a self-hosted tool for saving public media — profile pictures, posts, reels, stories, videos and audio — from Instagram, Facebook, Threads, TikTok, X, YouTube, SoundCloud, Reddit and VSCO. Everything runs locally on your machine; nothing is uploaded to a third-party server.',
  },
  {
    q: 'Which platforms are supported?',
    a: 'Instagram (profiles, posts, reels, stories, highlights), Facebook (profile pictures, videos), Threads (profiles), TikTok (profiles, videos), X / Twitter (tweets — image and video), YouTube (videos with quality picker), SoundCloud (audio in 320 kbps MP3), Reddit (videos) and VSCO (images).',
  },
  {
    q: 'Do I need to log in to use it?',
    a: 'No, public content works without any login. You only need to sign in for things like Instagram private profiles you follow, age-restricted YouTube videos, or Facebook videos that require an authenticated session.',
  },
  {
    q: 'How do I download from a private Instagram profile?',
    a: 'Open the Logged-in Sessions page from the sidebar, sign in to Instagram with your username and password (2FA is supported). Once your session is saved, search for any private profile you already follow and the posts grid will load.',
  },
  {
    q: 'Where are my session cookies stored?',
    a: 'In a local .env file in the project root, on your own machine. They never leave your computer. You can clear them at any time via the Logged-in Sessions page or by deleting the .env file manually.',
  },
  {
    q: 'Why does YouTube take a moment before downloading?',
    a: 'YouTube serves video and audio as separate streams. The server downloads both, then muxes them into a single MP4 with ffmpeg. That is what the "Preparing X%" indicator shows. The same flow is used for Reddit and Facebook videos.',
  },
  {
    q: 'The SoundCloud download says 320 kbps — is the audio actually that quality?',
    a: 'The output file is genuinely 320 kbps MP3, transcoded server-side with ffmpeg. If the SoundCloud source is only 128 kbps though, transcoding can not invent missing audio detail — you get a 320 kbps container with the source quality inside.',
  },
  {
    q: 'Why am I told an Instagram profile is private even though I follow it?',
    a: 'Make sure you are logged in via the Logged-in Sessions page and that the session has not expired. The server checks /friendships/show/ to confirm you actually follow the account before showing posts.',
  },
  {
    q: 'How can I support the project?',
    a: 'There is a Buy Me a Coffee button just above this menu. Donations are entirely optional and go directly to the developer.',
  },
  {
    q: 'Is it legal to download this content?',
    a: 'Yeti only fetches content you can already access in a normal browser. Whether you may keep, redistribute, or republish that content depends on the original creator\'s rights and the platform\'s terms of service. You are responsible for how you use anything you download.',
  },
];

const open = ref(0);
function toggle(i) {
  // Keep at least one question open at all times — clicking the active
  // one is a no-op; clicking another one switches the open question.
  if (open.value !== i) open.value = i;
}
</script>

<template>
  <div class="info-page">
    <div class="info-header">
      <h1>FAQ</h1>
      <p class="info-sub">Common questions about Yeti Media Downloader.</p>
    </div>

    <div class="faq-list">
      <div
        v-for="(item, i) in items"
        :key="i"
        class="faq-item"
        :class="{ open: open === i }"
      >
        <button class="faq-q" type="button" @click="toggle(i)">
          <span>{{ item.q }}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="faq-chev">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div v-if="open === i" class="faq-a">{{ item.a }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.info-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 0 60px;
}
.info-header { margin-bottom: 28px; }
.info-header h1 {
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 6px;
}
.info-sub { color: var(--text-dim); font-size: 0.9rem; }

.faq-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  width: 100%;
}
.faq-item {
  width: 100%;
  min-width: 0;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  transition: border-color 0.15s ease;
}
.faq-item:hover { border-color: var(--accent); }
.faq-item.open { border-color: var(--accent); }

.faq-q {
  width: 100%;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 16px 18px;
  background: transparent;
  border: none;
  outline: none;
  text-align: left;
  font-family: var(--font);
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
.faq-q:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 12px;
}
.faq-chev {
  width: 18px; height: 18px;
  color: var(--text-dim);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}
.faq-item.open .faq-chev { transform: rotate(180deg); color: var(--accent); }

.faq-a {
  padding: 0 18px 16px;
  color: var(--text-dim);
  font-size: 0.86rem;
  line-height: 1.6;
}

@media (max-width: 600px) {
  .info-page { padding: 24px 16px 60px; }
}
</style>
