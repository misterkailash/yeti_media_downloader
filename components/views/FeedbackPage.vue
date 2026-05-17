<script setup>
import { ref, computed } from 'vue';

const TYPES = [
  { id: 'bug', label: 'Bug report', desc: 'Something is broken or behaving unexpectedly' },
  { id: 'suggestion', label: 'Suggestion', desc: 'Idea to improve an existing feature' },
  { id: 'feature', label: 'Feature request', desc: 'A new feature you would like to see' },
  { id: 'other', label: 'Other', desc: 'General comments or anything else' },
];

const form = ref({
  type: 'bug',
  name: '',
  email: '',
  message: '',
});

const submitting = ref(false);
const status = ref(null); // 'success' | 'error' | null
const errorMsg = ref('');

const messageRemaining = computed(() => 2000 - form.value.message.length);
const canSubmit = computed(() =>
  !submitting.value &&
  form.value.message.trim().length >= 10 &&
  form.value.message.length <= 2000
);

function pickType(id) {
  form.value.type = id;
}

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  status.value = null;
  errorMsg.value = '';
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: form.value.type,
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        message: form.value.message.trim(),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server returned ${res.status}`);
    }
    status.value = 'success';
    form.value = { type: 'bug', name: '', email: '', message: '' };
  } catch (err) {
    status.value = 'error';
    errorMsg.value = err.message || 'Failed to send feedback.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="info-page">
    <div class="info-header">
      <h1>Feedback</h1>
      <p class="info-sub">Found a bug? Have an idea? Tell me about it.</p>
    </div>

    <form class="fb-form" @submit.prevent="submit">
      <div class="fb-field">
        <label class="fb-label">What kind of feedback?</label>
        <div class="fb-types">
          <button
            v-for="t in TYPES"
            :key="t.id"
            type="button"
            class="fb-type"
            :class="{ active: form.type === t.id }"
            @click="pickType(t.id)"
          >
            <span class="fb-type-label">{{ t.label }}</span>
            <span class="fb-type-desc">{{ t.desc }}</span>
          </button>
        </div>
      </div>

      <div class="fb-row">
        <div class="fb-field">
          <label class="fb-label" for="fb-name">Name <span class="fb-opt">(optional)</span></label>
          <input
            id="fb-name"
            v-model="form.name"
            type="text"
            class="fb-input"
            placeholder="Your name"
            maxlength="80"
          >
        </div>
        <div class="fb-field">
          <label class="fb-label" for="fb-email">Email <span class="fb-opt">(optional)</span></label>
          <input
            id="fb-email"
            v-model="form.email"
            type="email"
            class="fb-input"
            placeholder="So I can reply if needed"
            maxlength="120"
          >
        </div>
      </div>

      <div class="fb-field">
        <label class="fb-label" for="fb-message">
          Message
          <span class="fb-opt fb-counter" :class="{ warn: messageRemaining < 0 }">
            {{ messageRemaining }} characters left
          </span>
        </label>
        <textarea
          id="fb-message"
          v-model="form.message"
          class="fb-textarea"
          :placeholder="form.type === 'bug'
            ? 'What went wrong? Include the platform, the URL you tried, and what you expected to happen.'
            : 'Describe your idea or comment in as much detail as you like.'"
          rows="7"
          maxlength="2000"
        ></textarea>
      </div>

      <div class="fb-actions">
        <button type="submit" class="fb-submit" :disabled="!canSubmit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          {{ submitting ? 'Sending…' : 'Send feedback' }}
        </button>
        <span v-if="status === 'success'" class="fb-flash success">
          Thanks — your feedback was received.
        </span>
        <span v-else-if="status === 'error'" class="fb-flash error">
          {{ errorMsg }}
        </span>
      </div>
    </form>
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
.info-sub { color: var(--text-dim); font-size: 0.9rem; }

.fb-form {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 14px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.fb-field { display: flex; flex-direction: column; gap: 8px; }
.fb-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.fb-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.fb-opt {
  font-weight: 500;
  font-size: 0.74rem;
  color: var(--text-dim);
}
.fb-counter.warn { color: #e8564a; }

.fb-types {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.fb-type {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 14px;
  background: var(--bg);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  text-align: left;
  font-family: var(--font);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.fb-type:hover { border-color: var(--accent); }
.fb-type.active {
  border-color: var(--accent);
  background: var(--accent-light);
}
.fb-type-label {
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--text);
}
.fb-type.active .fb-type-label { color: var(--accent); }
.fb-type-desc {
  font-size: 0.74rem;
  color: var(--text-dim);
  line-height: 1.4;
}

.fb-input,
.fb-textarea {
  width: 100%;
  font-family: var(--font);
  font-size: 0.88rem;
  color: var(--text);
  background: var(--bg);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 11px 14px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.fb-input::placeholder,
.fb-textarea::placeholder { color: var(--text-dim); opacity: 0.7; }
.fb-input:focus,
.fb-textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}
.fb-textarea {
  resize: vertical;
  min-height: 140px;
  line-height: 1.5;
}

.fb-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.fb-submit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 20px;
  font-family: var(--font);
  font-size: 0.88rem;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #22c55e 0%, #15803d 100%);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(21, 128, 61, 0.28);
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.fb-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(21, 128, 61, 0.4);
}
.fb-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.fb-submit svg { width: 16px; height: 16px; }

.fb-flash { font-size: 0.85rem; font-weight: 500; }
.fb-flash.success { color: #15803d; }
.fb-flash.error { color: #e8564a; }

@media (max-width: 600px) {
  .info-page { padding: 24px 16px 60px; }
  .fb-row { grid-template-columns: 1fr; }
  .fb-types { grid-template-columns: 1fr; }
}
</style>
