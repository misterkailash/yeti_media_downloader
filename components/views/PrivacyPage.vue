<script setup>
const updated = '2026-05-09';
</script>

<template>
  <div class="info-page">
    <div class="info-header">
      <h1>Privacy Policy</h1>
      <p class="info-sub">Last updated: {{ updated }}</p>
    </div>

    <section class="info-section">
      <p>
        Yeti Media Downloader ("Yeti", "the app") is a self-hosted tool that runs
        on your own machine. This document explains what data the app handles
        and how it is used.
      </p>
    </section>

    <section class="info-section">
      <h2>1. What we collect</h2>
      <p>
        <strong>Nothing is collected on a remote server we control.</strong>
        Yeti has no analytics, no telemetry, no user accounts on our side, and
        no remote database. There is no signup, no email collection, and no
        tracking pixel.
      </p>
    </section>

    <section class="info-section">
      <h2>2. Data stored on your device</h2>
      <ul>
        <li>
          <strong>Session cookies for third-party platforms</strong> — when you
          choose to sign in to Instagram, Facebook or TikTok via the
          Logged-in Sessions page, the relevant session tokens
          (e.g. Instagram <code>sessionid</code>, Facebook <code>c_user</code>
          and <code>xs</code>, TikTok <code>sessionid</code>) are written to a
          local <code>.env</code> file in the project root. They are
          used solely to authenticate requests to those platforms on your
          behalf and never leave your machine.
        </li>
        <li>
          <strong>Downloaded media</strong> — files you download are saved
          straight to your browser's default Downloads folder. Yeti does not
          retain copies on the server beyond short-lived temp files used while
          muxing video and audio (these are deleted automatically after the
          download completes).
        </li>
        <li>
          <strong>UI preferences</strong> — small client-side state such as the
          currently selected platform is held in memory for the duration of
          the page session. Nothing is written to <code>localStorage</code> or
          cookies by Yeti itself.
        </li>
      </ul>
    </section>

    <section class="info-section">
      <h2>3. Requests to third-party platforms</h2>
      <p>
        To fetch the media you ask for, Yeti makes outbound requests to
        Instagram, Facebook, Threads, TikTok, X, YouTube, SoundCloud, Reddit
        and VSCO. These requests are subject to those platforms' own privacy
        policies and terms of service. Yeti does not modify, intercept or
        share the data those services return beyond what is needed to display
        and download the requested item.
      </p>
    </section>

    <section class="info-section">
      <h2>4. Server logs</h2>
      <p>
        The Node server prints diagnostic messages to its own console
        (e.g. failed authentication, fetch errors). These logs live only in
        the terminal where you ran the dev server. They are not
        transmitted anywhere and are gone when the process exits.
      </p>
    </section>

    <section class="info-section">
      <h2>5. Donations</h2>
      <p>
        If you choose to support the project via the Buy Me a Coffee link, the
        payment is processed entirely by Buy Me a Coffee. Yeti does not
        receive your name, email or payment details — only what Buy Me a
        Coffee shows publicly to me as the recipient.
      </p>
    </section>

    <section class="info-section">
      <h2>6. Your responsibility</h2>
      <p>
        Yeti only retrieves content you can already access in a normal
        browser. Whether you may keep, redistribute or republish that content
        is governed by the original creator's rights and each platform's
        terms of service. You are responsible for how you use anything you
        download.
      </p>
    </section>

    <section class="info-section">
      <h2>7. Children's privacy</h2>
      <p>
        Yeti is not directed at children under 13. Because the app does not
        collect personal information centrally, no child-specific data is
        ever transmitted to us.
      </p>
    </section>

    <section class="info-section">
      <h2>8. Changes to this policy</h2>
      <p>
        If the way Yeti handles data changes meaningfully, this page will be
        updated and the "Last updated" date at the top will be revised. Since
        you run the app yourself, any change reaches you only when you pull
        new code — there is no silent server-side update.
      </p>
    </section>

    <section class="info-section">
      <h2>9. Contact</h2>
      <p>
        Questions, concerns or takedown requests: open an issue on the
        project's repository or reach the developer via the Buy Me a Coffee
        page linked in the sidebar.
      </p>
    </section>
  </div>
</template>

<style scoped>
.info-page {
  max-width: 760px;
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
.info-sub { color: var(--text-dim); font-size: 0.85rem; }

.info-section {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  margin-bottom: 14px;
}
.info-section h2 {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 8px;
}
.info-section p,
.info-section li {
  color: var(--text-dim);
  font-size: 0.86rem;
  line-height: 1.6;
}
.info-section p + p { margin-top: 8px; }
.info-section ul { padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
.info-section strong { color: var(--text); font-weight: 600; }
.info-section code {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.78rem;
  color: var(--text);
}

@media (max-width: 600px) {
  .info-page { padding: 24px 16px 60px; }
}
</style>
