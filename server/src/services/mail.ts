import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let transporter: Transporter | null = null;

export const emailConfigured = () => Boolean(env.SMTP_HOST);

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Link included in the message; logged in development when SMTP is not configured. */
  devLink?: string;
}

export async function sendMail(msg: MailMessage): Promise<void> {
  const t = getTransporter();
  if (!t) {
    if (!env.isProduction) {
      // Development convenience only — production never logs links that carry tokens.
      logger.warn({ to: msg.to, subject: msg.subject, link: msg.devLink }, 'SMTP not configured; email not sent');
    } else {
      logger.error({ subject: msg.subject }, 'SMTP not configured; email not sent');
    }
    return;
  }
  try {
    await t.sendMail({ from: env.SMTP_FROM, to: msg.to, subject: msg.subject, text: msg.text });
  } catch (err) {
    logger.error({ err, subject: msg.subject }, 'Failed to send email');
  }
}
