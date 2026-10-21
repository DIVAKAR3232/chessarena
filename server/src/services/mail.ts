/**
 * Outgoing email (password resets, verification, admin test messages).
 *
 * Providers, in order of preference:
 *   1. Brevo HTTP API (BREVO_API_KEY): sends over HTTPS, so it works on hosts that block SMTP
 *      ports, such as Render's free plan.
 *   2. SMTP (SMTP_HOST + SMTP_USER + SMTP_PASS), e.g. Gmail with an App Password.
 * With neither configured, nothing is sent; in development the message (including any link)
 * is written to the server log instead.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export type MailProvider = 'brevo' | 'smtp' | 'none';

const DEFAULT_FROM = 'ISTA ChessArena <no-reply@chessarena.local>';
const SEND_TIMEOUT_MS = 15_000;

export function mailProvider(): MailProvider {
  if (env.BREVO_API_KEY) return 'brevo';
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) return 'smtp';
  return 'none';
}

export const emailConfigured = () => mailProvider() !== 'none';

/** Sender as configured (MAIL_FROM, legacy SMTP_FROM, or the SMTP user). */
export function mailFrom(): { name: string; email: string; formatted: string } {
  const raw = env.MAIL_FROM || env.SMTP_FROM || (env.SMTP_USER ? `ISTA ChessArena <${env.SMTP_USER}>` : DEFAULT_FROM);
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const name = (m?.[1] ?? '').trim() || 'ISTA ChessArena';
  const email = (m?.[2] ?? raw).trim();
  return { name, email, formatted: `${name} <${email}>` };
}

let transporter: Transporter | null = null;
function smtpTransport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    requireTLS: env.SMTP_PORT !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Link included in the message; logged in development when no provider is configured. */
  devLink?: string;
}

export interface MailResult {
  ok: boolean;
  provider: MailProvider;
  error?: string;
}

async function sendViaBrevo(msg: MailMessage): Promise<void> {
  const from = mailFrom();
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: from.name, email: from.email },
      to: [{ email: msg.to }],
      subject: msg.subject,
      textContent: msg.text,
      ...(msg.html ? { htmlContent: msg.html } : {}),
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Brevo explains rejected senders/keys in the body; never includes our key.
    throw new Error(`Brevo responded ${res.status}: ${body.slice(0, 300)}`);
  }
}

/** Sends one email and reports the outcome (never throws). */
export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const provider = mailProvider();
  if (provider === 'none') {
    if (!env.isProduction) {
      logger.warn({ to: msg.to, subject: msg.subject, link: msg.devLink }, 'Email not configured; message logged instead of sent');
    } else {
      logger.error({ subject: msg.subject }, 'Email not configured; message not sent');
    }
    return { ok: false, provider, error: 'Email sending is not configured on the server' };
  }
  try {
    if (provider === 'brevo') await sendViaBrevo(msg);
    else await smtpTransport().sendMail({ from: mailFrom().formatted, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    logger.info({ provider, subject: msg.subject }, 'Email sent');
    return { ok: true, provider };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ provider, subject: msg.subject, error }, 'Failed to send email');
    return { ok: false, provider, error };
  }
}

/** Fire-and-forget: the HTTP response does not wait for the mail server. */
export function queueMail(msg: MailMessage): void {
  void sendMail(msg);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Simple, email-client-safe HTML layout in the ChessArena Halloween colours. */
export function renderEmail(opts: { heading: string; paragraphs: string[]; button?: { label: string; url: string }; footnote?: string }) {
  const p = opts.paragraphs.map((t) => `<p style="margin:0 0 14px;color:#e9e2f4;font-size:15px;line-height:1.5">${escapeHtml(t)}</p>`).join('');
  const button = opts.button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(opts.button.url)}" style="background:#f97316;color:#1b1129;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;display:inline-block">${escapeHtml(opts.button.label)}</a></p>
       <p style="margin:0 0 14px;color:#9a89b4;font-size:12px;word-break:break-all">Or open this link: ${escapeHtml(opts.button.url)}</p>`
    : '';
  const foot = opts.footnote ? `<p style="margin:18px 0 0;color:#9a89b4;font-size:12px">${escapeHtml(opts.footnote)}</p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;background:#0c0713;padding:24px;font-family:Segoe UI,Arial,sans-serif">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#1b1129;border:1px solid #3e2c55;border-radius:12px">
    <tr><td style="padding:24px">
      <p style="margin:0 0 4px;color:#9a89b4;font-size:11px;letter-spacing:3px;text-transform:uppercase">ISTA presents</p>
      <p style="margin:0 0 18px;color:#fdba74;font-size:22px;font-weight:bold">🎃 ChessArena <span style="font-size:12px;color:#9a89b4">i++'26</span></p>
      <h1 style="margin:0 0 14px;color:#f6f1fc;font-size:19px">${escapeHtml(opts.heading)}</h1>
      ${p}${button}${foot}
    </td></tr>
  </table></body></html>`;
}
