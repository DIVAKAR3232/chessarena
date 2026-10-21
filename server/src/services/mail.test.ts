import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadMail(envOverrides: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
  return import('./mail.js');
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ['BREVO_API_KEY', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) process.env[k] = '';
});

describe('mail service', () => {
  it('reports "none" and does not throw when no provider is configured', async () => {
    const mail = await loadMail({ BREVO_API_KEY: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' });
    expect(mail.mailProvider()).toBe('none');
    const r = await mail.sendMail({ to: 'a@example.test', subject: 's', text: 't' });
    expect(r.ok).toBe(false);
  });

  it('needs SMTP credentials, not just a host, to count as configured', async () => {
    const mail = await loadMail({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'x@gmail.com', SMTP_PASS: '' });
    expect(mail.mailProvider()).toBe('none');
  });

  it('parses MAIL_FROM into a name and address', async () => {
    const mail = await loadMail({ MAIL_FROM: 'ISTA ChessArena <rangasamymeena945@gmail.com>' });
    expect(mail.mailFrom()).toEqual({
      name: 'ISTA ChessArena',
      email: 'rangasamymeena945@gmail.com',
      formatted: 'ISTA ChessArena <rangasamymeena945@gmail.com>',
    });
  });

  it('sends through the Brevo API with the configured sender', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"messageId":"1"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const mail = await loadMail({ BREVO_API_KEY: 'test-key', MAIL_FROM: 'ISTA ChessArena <rangasamymeena945@gmail.com>' });
    expect(mail.mailProvider()).toBe('brevo');
    const r = await mail.sendMail({ to: 'player@example.test', subject: 'Reset', text: 'link', html: '<p>link</p>' });
    expect(r).toEqual({ ok: true, provider: 'brevo' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('test-key');
    expect(JSON.parse(init.body)).toEqual({
      sender: { name: 'ISTA ChessArena', email: 'rangasamymeena945@gmail.com' },
      to: [{ email: 'player@example.test' }],
      subject: 'Reset',
      textContent: 'link',
      htmlContent: '<p>link</p>',
    });
  });

  it('returns Brevo error details instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"Sender not verified"}', { status: 400 })));
    const mail = await loadMail({ BREVO_API_KEY: 'test-key' });
    const r = await mail.sendMail({ to: 'player@example.test', subject: 'Reset', text: 'link' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Sender not verified');
  });

  it('escapes user-controlled text in the HTML template', async () => {
    const mail = await loadMail({});
    const html = mail.renderEmail({ heading: 'Hi <script>x</script>', paragraphs: ['a & b'] });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('<meta charset="utf-8">');
  });
});
