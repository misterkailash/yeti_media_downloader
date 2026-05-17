# Yeti Media Downloader

A sleek, all-in-one social media downloader that lets you save profile pictures, posts, reels, stories, and videos from multiple platforms — built on **Nuxt 3** with server-side rendering so every platform has its own SEO-indexable URL.

![Yeti Media Downloader](screenshot.png)

## Supported Platforms

| Platform | Features |
|----------|----------|
| **Instagram** | Profile pictures (HD), posts, reels, stories, highlights, carousel albums, single-post URL lookup. Tabbed results view with one-click "Download all" zip per tab. Supports private profiles via login. |
| **Facebook** | Profile pictures, page logos, public + login-gated video downloads |
| **Threads** | Profile pictures, follower stats |
| **TikTok** | Profile pictures, **original 1080p no-watermark** video downloads (parses tikdownloader.io's HD anchor + decodes the snapcdn JWT to fetch the `_original.mp4` straight from TikTok's CDN — multi-extractor fallback to ssstik / mobile API / tikwm) |
| **YouTube** | 144p → 4K video + audio, on-demand mux via yt-dlp + ffmpeg |
| **X / Twitter** | Tweet photos and videos |
| **Reddit** | DASH video + audio muxed to MP4 |
| **SoundCloud** | 320 kbps CBR MP3 transcode |
| **VSCO** | HD image downloads from post URLs |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+

### Installation

```bash
git clone https://github.com/misterkailash/yeti_media_downloader.git
cd yeti_media_downloader
npm install
```

### Running the App

```bash
npm run dev
```

App is at `http://localhost:3000`. The entire backend (all `/api/*` routes) runs as native Nitro endpoints under `server/api/`, so it's just **one** process — one port, one `npm run dev`.

**Windows users:** double-click `start.bat`.

**Production build:**

```bash
npm run build       # bundles to .output/
npm start           # runs .output/server/index.mjs
```

### Optional: Instagram Session

For HD profile pictures and access to private profiles you follow, create a `.env` file in the project root:

```env
IG_SESSIONID=your_session_id_here
```

You can also log in directly from the app's sidebar.

## How to Use

1. **Pick a platform** from the landing-page grid (or go directly to `/tiktok`, `/instagram`, etc.)
2. **Enter a username or paste a URL** in the search bar (Instagram autocompletes as you type)
3. **Click Fetch** to load the profile or media
4. **Browse and download** — click any post, story, or highlight to preview and download. On Instagram the result splits into Profile / Stories / Highlights / Photos / Reels / Videos tabs, each with its own "Download all" zip button.

Each platform is its own URL (`/tiktok`, `/tiktok-videos`, `/youtube`, …) so links are shareable and bookmarkable. Switching between them is client-side — the sidebar and modals stay mounted, so it feels like one continuous page.

## Tech Stack

- **Framework:** [Nuxt 3](https://nuxt.com/) with SSR — every route is server-rendered for SEO, then hydrated for instant client-side navigation
- **State:** [Pinia](https://pinia.vuejs.org/) (auto-imported via `@pinia/nuxt`)
- **Backend:** [Nitro](https://nitro.unjs.io/) hosting an [Express 5](https://expressjs.com/) app as middleware, plus a native `server/api/` and `server/routes/` surface for new endpoints (sitemap, etc.)
- **Image processing:** [sharp](https://sharp.pixelplumbing.com/) for WebP→JPEG transcoding
- **Media muxing:** [yt-dlp](https://github.com/yt-dlp/yt-dlp) + [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) for YouTube / Facebook video / Reddit / SoundCloud
- **Mail:** [nodemailer](https://nodemailer.com/) for the feedback form
- **Styling:** Hand-rolled CSS with custom properties (navy/ice-blue palette pulled from the Yeti logo)

## Frontend Architecture

**File-based routing** — each platform is a real URL, served SSR-first:

```
/                      pages/index.vue           landing (hero + platform picker)
/instagram             pages/[platform].vue      profile pic + posts + stories
/instagram-post        pages/[platform].vue      single-post / reel by URL
/facebook              pages/[platform].vue      profile pic
/facebook-videos       pages/[platform].vue      public + login-gated video
/threads               pages/[platform].vue      profile pic + stats
/tiktok                pages/[platform].vue      profile pic
/tiktok-videos         pages/[platform].vue      HD no-watermark video
/youtube               pages/[platform].vue      video + quality picker
/soundcloud            pages/[platform].vue      320 kbps MP3
/reddit                pages/[platform].vue      DASH mux
/x                     pages/[platform].vue      tweet photos / videos
/vsco                  pages/[platform].vue      post images
/sessions              pages/sessions.vue        login session manager
/faq, /feedback, /privacy
/sitemap.xml           server/routes/sitemap.xml.get.js
```

`pages/[platform].vue` validates the slug via `definePageMeta({ validate })` — unknown platforms 404. It syncs the Pinia `platform` store from `route.params.platform`, so direct navigation, in-app clicks, and browser back/forward all behave identically. `useSeoMeta()` sets a unique `<title>` + description + Open Graph block per platform.

The shared shell lives in `layouts/default.vue` — Sidebar, modals (`PostModal`, `StoryViewer`, `LoginModal`), and `BackToTop` stay mounted across navigation, so switching platforms is a `<slot />` swap with no flash.

**Data flow** — state lives in Pinia stores, components stay presentational and pull reactive refs via `storeToRefs`. Every fetch flows through a store; components never call `fetch` directly.

```
SearchBar ─▶ search store ─▶ /api/<endpoint> ─▶ search store fills profile/video refs
                                                       │
                                                       ▼
                ProfileResult / VideoResult ◀── storeToRefs(searchStore)
                       │
                       ├──▶ posts store    (PostsGrid + PostModal carousel)
                       └──▶ stories store  (StoriesSection / HighlightsSection / StoryViewer)
```

**Components** (`components/`, auto-imported by Nuxt)
- Layout: `Sidebar`, `Hero`, `BackToTop`
- Search: `PlatformPicker` (NuxtLink cards), `SearchBar` (debounced IG autocomplete)
- Results: `ProfileResult`, `VideoResult`, `PostsGrid`, `StoriesSection`, `HighlightsSection`
- Modals: `PostModal` (carousel-aware), `StoryViewer` (prev/next chevrons + bulk-download for highlight reels), `LoginModal`
- Status: `LoadingSpinner`, `ErrorBanner`, `AuthWarningBanner`
- `components/platforms/` — 12 thin per-platform wrappers that compose result components
- `components/views/` — bodies for the static pages (sessions / faq / feedback / privacy)

**Pinia stores** (`stores/`, auto-imported via `@pinia/nuxt`)
- `platform` — current platform + per-platform endpoint config
- `search` — query, autocomplete debounce, profile/video result state, fetch orchestration
- `posts` — Instagram posts grid, infinite scroll cursor, post-modal/carousel state
- `stories` — stories, highlights, story viewer; bulk-download with progress refs
- `login` — Instagram session, 2FA flow, sidebar status
- `sessions` — Facebook + TikTok login state for the `/sessions` page
- `ui` — sidebar toggle, loading, error, auth warning banner
- `authHandler` — shared 401 handler for IG endpoints

## Backend Architecture

The backend is native Nitro: every endpoint lives in `server/api/` and Nuxt routes it directly — no Express bridge, no separate processes. Stateful helpers (mux caches, session map, .env-derived dev defaults) live in `lib/` (CJS) with thin ESM facades in `server/utils/`.

The endpoints fall into four buckets:

1. **Public-data scrapers** — Instagram, Facebook, Threads, TikTok, X, VSCO. Each is its own file (e.g. `server/api/profile/[username].get.js`, `server/api/tt-video.get.js`) that scrapes public HTML / og-tags or calls public mobile APIs.
2. **Media muxers** — five `<platform>-info` + `<platform>-prepare-status` + `<platform>-stream` trios (YouTube, FB-video, Reddit, SoundCloud, IG single-post). Each platform has a `lib/<platform>-mux.js` module holding the shared in-process cache; the three Nitro endpoints import the same `getEntry()` factory so polling and streaming converge on the same yt-dlp + ffmpeg pipeline.
3. **CDN proxies with referer rewriting** — `/api/image-proxy`, `/api/tt-video-proxy`, `/api/ig-video-proxy`. The browser can't fetch TikTok/Instagram CDN URLs directly (referer/CORS gates), so these stream bytes through with the correct headers, optionally transcoding WebP→JPEG via `sharp` for downloads.
4. **Authenticated paths** — when an Instagram, Facebook, or TikTok session is present, scrapers fall back to authenticated endpoints (e.g. `i.instagram.com/api/v1/*`) for HD assets and private-account access. Sessions live in an in-memory `Map` keyed by an HttpOnly `yeti_session` cookie, exposed through `AsyncLocalStorage` so helper functions can call `getIg()`/`getFb()`/`getTt()` without threading the session through every signature. `server/middleware/00-session.js` enters the AsyncLocalStorage context once per request.

**TikTok HD extraction (multi-source fallback chain).** TikTok's public `playAddr` is watermarked and capped at preview bitrate, so getting the `_original.mp4` requires bouncing through extractor sites that have signed mobile-API access. `lib/tt.js` runs ssstik + tikdownloader concurrently with `Promise.all` and prefers any HD result:

```
ssstik.io (parallel) ─┐
                      ├──▶ pick whichever returns an "HD" anchor first (decode snapcdn JWT)
tikdownloader.io ─────┘             │ both fail
                                    ▼
                          TikTok mobile API (musical_ly aid=1233)
                                    │ blocked
                                    ▼
                          tikwm.com (HD re-encode, ~720p)
                                    │ blocked
                                    ▼
                          TikTok web JSON (__UNIVERSAL_DATA__, watermarked)
```

The HD button on tikdownloader points at `dl.snapcdn.app/get?token=<JWT>` whose payload is `{"url":"https://*.tokcdn.com/.../<id>_original.mp4?dl=1"}` — decoding the JWT skips the redirector so the browser pulls the original MP4 straight from TikTok's CDN.

## Project Structure

```
yeti_media_downloader/
├── nuxt.config.ts                # Nuxt config (modules, SSR, global CSS, head)
├── package.json
├── start.bat                     # One-click launcher (Windows)
├── .env                          # Session tokens (optional, not committed)
├── pages/                        # File-based routes
│   ├── index.vue                 # /
│   ├── [platform].vue            # /:platform (12 platforms, validated)
│   ├── sessions.vue
│   ├── faq.vue
│   ├── feedback.vue
│   └── privacy.vue
├── layouts/
│   └── default.vue               # Persistent shell: Sidebar + modals + BackToTop
├── components/                   # Auto-imported by Nuxt
│   ├── Sidebar.vue, Hero.vue, PlatformPicker.vue, SearchBar.vue, …
│   ├── platforms/                # 12 per-platform compositions
│   └── views/                    # Bodies for sessions / faq / feedback / privacy
├── stores/                       # Auto-imported by @pinia/nuxt
├── assets/                       # Logo, platform icons, global styles.css
├── public/                       # robots.txt, logo.png (favicon)
├── server/
│   ├── api/                      # All Nitro endpoints (~45 files)
│   ├── routes/                   # /fb-auth, /tt-auth HTML pages, sitemap.xml
│   ├── middleware/00-session.js  # Per-request AsyncLocalStorage entry
│   ├── plugins/dev-defaults.js   # .env → DEV_DEFAULTS on Nitro boot
│   └── utils/                    # ESM facades over lib/*
└── lib/                          # CJS source of truth: http, session, ig, fb, tt,
                                  # image-proxy, album-zip, send-file, *-mux, …
```

## License

ISC

---

*Built by Kailash*
