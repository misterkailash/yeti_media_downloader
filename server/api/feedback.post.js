// POST /api/feedback
//
// Each submission appends one JSON line to feedback.jsonl in the project
// root, then forwards via SMTP if credentials are configured. Trivial
// validation (length caps, allowed types) keeps junk out; no auth or
// rate-limit because the app is self-hosted.
//
// Mailer is initialised once at module load — Nitro keeps this module
// resident, so this matches the "build the transport at startup" behavior
// of the original server.js. .env is loaded automatically by Nuxt, so
// SMTP_USER / SMTP_PASS / FEEDBACK_TO etc. come from process.env.
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

const FEEDBACK_TYPES = new Set(['bug', 'suggestion', 'feature', 'other']);
const FEEDBACK_TYPE_LABELS = {
  bug: 'Bug report',
  suggestion: 'Suggestion',
  feature: 'Feature request',
  other: 'Other',
};
const FEEDBACK_FILE = path.join(process.cwd(), 'feedback.jsonl');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp-mail.outlook.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FEEDBACK_TO = process.env.FEEDBACK_TO || 'misterkailash@hotmail.com';

const mailer = (SMTP_USER && SMTP_PASS) ? nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
}) : null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export default defineEventHandler(async (event) => {
  try {
    const body = (await readBody(event)) || {};
    const type = String(body.type || '').trim();
    const name = String(body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().slice(0, 120);
    const message = String(body.message || '').trim();

    if (!FEEDBACK_TYPES.has(type)) {
      setResponseStatus(event, 400);
      return { error: 'Invalid feedback type.' };
    }
    if (message.length < 10) {
      setResponseStatus(event, 400);
      return { error: 'Message is too short (minimum 10 characters).' };
    }
    if (message.length > 2000) {
      setResponseStatus(event, 400);
      return { error: 'Message is too long (maximum 2000 characters).' };
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setResponseStatus(event, 400);
      return { error: 'Email looks invalid.' };
    }

    const entry = {
      ts: new Date().toISOString(),
      type, name, email, message,
      ua: String(getHeader(event, 'user-agent') || '').slice(0, 200),
    };
    // Always persist to disk first — even if SMTP fails, feedback isn't lost.
    fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(entry) + '\n', 'utf8');
    console.log(`[feedback] ${type}${name ? ' from ' + name : ''}${email ? ' <' + email + '>' : ''}: ${message.slice(0, 80)}${message.length > 80 ? '…' : ''}`);

    // Fire-and-forget email — SMTP failure doesn't fail the user submission.
    if (mailer) {
      const typeLabel = FEEDBACK_TYPE_LABELS[type] || type;
      const subjectName = name ? ` from ${name}` : '';
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;color:#1c3559;">
          <h2 style="margin:0 0 16px;color:#1c3559;">New Yeti feedback: ${escapeHtml(typeLabel)}</h2>
          <table style="border-collapse:collapse;font-size:14px;width:100%;">
            <tr><td style="padding:6px 12px 6px 0;color:#6a7d94;width:90px;">Type</td><td style="padding:6px 0;"><strong>${escapeHtml(typeLabel)}</strong></td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#6a7d94;">Name</td><td style="padding:6px 0;">${escapeHtml(name || '—')}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#6a7d94;">Email</td><td style="padding:6px 0;">${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : '—'}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#6a7d94;">Submitted</td><td style="padding:6px 0;">${escapeHtml(entry.ts)}</td></tr>
          </table>
          <h3 style="margin:24px 0 8px;color:#1c3559;">Message</h3>
          <div style="white-space:pre-wrap;background:#eef5fb;border:1px solid #d6e3ef;border-radius:8px;padding:14px;font-size:14px;line-height:1.55;">${escapeHtml(message)}</div>
          <p style="margin:20px 0 0;font-size:12px;color:#8aa4c2;">User agent: ${escapeHtml(entry.ua)}</p>
        </div>`;
      const text = `New Yeti feedback: ${typeLabel}\n\n` +
        `Type:    ${typeLabel}\n` +
        `Name:    ${name || '—'}\n` +
        `Email:   ${email || '—'}\n` +
        `Sent at: ${entry.ts}\n` +
        `User-agent: ${entry.ua}\n\n` +
        `--- Message ---\n${message}\n`;

      mailer.sendMail({
        from: `"Yeti Feedback" <${SMTP_USER}>`,
        to: FEEDBACK_TO,
        replyTo: email || undefined,
        subject: `[Yeti] ${typeLabel}${subjectName}`,
        text,
        html,
      }).then(info => {
        console.log(`[mail] feedback emailed (${info.messageId || 'ok'})`);
      }).catch(err => {
        console.warn(`[mail] feedback email failed: ${err.message}`);
      });
    }

    return { success: true };
  } catch (err) {
    console.error('[feedback] error:', err.message);
    setResponseStatus(event, 500);
    return { error: 'Could not save feedback. Please try again.' };
  }
});
