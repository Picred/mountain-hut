import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

/**
 * Unit tests for emailService.js.
 *
 * Runs in streamTransport (in-memory) mode without opening any real network
 * connections. Setting MAIL_USER and MAIL_PASS to empty strings before importing
 * ensures emailService.js selects nodemailer's stream transport even if credentials
 * exist in a local .env file.
 */

let sendEmail;

const originalUser = process.env.MAIL_USER;
const originalPass = process.env.MAIL_PASS;
const originalFrom = process.env.MAIL_FROM;

beforeAll(async () => {
  process.env.MAIL_USER = '';
  process.env.MAIL_PASS = '';
  const mod = await import('../../../backend/services/emailService.js');
  sendEmail = mod.sendEmail;
});

afterAll(() => {
  process.env.MAIL_USER = originalUser;
  process.env.MAIL_PASS = originalPass;
  process.env.MAIL_FROM = originalFrom;
});

const sampleEmail = {
  to: 'hiker@mountainhut.test',
  subject: 'Reservation Confirmation #101',
  text: 'Your reservation is confirmed.',
  html: '<p>Your reservation is confirmed.</p>',
};

describe('emailService', () => {
  it('sends an email using stream transport and returns the info object', async () => {
    const info = await sendEmail(sampleEmail);

    expect(info).toBeDefined();
    // streamTransport returns the raw email as a buffer in info.message
    expect(info.message).toBeInstanceOf(Buffer);
  });

  it('includes the correct recipient in the sent email', async () => {
    const info = await sendEmail(sampleEmail);
    const raw = info.message.toString();

    expect(raw).toContain('hiker@mountainhut.test');
  });

  it('includes the correct subject in the sent email', async () => {
    const info = await sendEmail(sampleEmail);
    const raw = info.message.toString();

    expect(raw).toContain('Reservation Confirmation #101');
  });

  it('includes the body text in the sent email', async () => {
    const info = await sendEmail(sampleEmail);
    const raw = info.message.toString();

    expect(raw).toContain('Your reservation is confirmed.');
  });

  it('uses default sender when MAIL_FROM is not configured', async () => {
    delete process.env.MAIL_FROM;
    const info = await sendEmail(sampleEmail);
    const raw = info.message.toString();

    expect(raw).toContain('no-reply@mountainhut.local');
  });

  it('uses custom MAIL_FROM when configured', async () => {
    process.env.MAIL_FROM = 'Custom Sender <sender@mountainhut.test>';
    const info = await sendEmail(sampleEmail);
    const raw = info.message.toString();

    expect(raw).toContain('sender@mountainhut.test');
    delete process.env.MAIL_FROM;
  });

  it('reuses the cached transporter on subsequent calls (line 19)', async () => {
    // Calling sendEmail again exercises getTransporter() when `transporter`
    // is already defined, verifying that it reuses the instance without error.
    const info = await sendEmail({
      ...sampleEmail,
      to: 'another@mountainhut.test',
    });

    expect(info).toBeDefined();
    expect(info.message).toBeInstanceOf(Buffer);
    expect(info.message.toString()).toContain('another@mountainhut.test');
  });
});

/**
 * With credentials the service connects to an SMTP server: nodemailer is mocked,
 * so nothing leaves the machine. Each test imports a fresh copy of the service,
 * since the transporter is created once and then cached.
 */
describe('emailService with SMTP credentials', () => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail }));

  async function loadService(env) {
    // empty values are not overwritten by a local backend/.env
    Object.assign(process.env, { MAIL_HOST: '', MAIL_PORT: '', MAIL_FROM: '', ...env });
    vi.resetModules();
    vi.doMock('nodemailer', () => ({ default: { createTransport } }));
    return (await import('../../../backend/services/emailService.js')).sendEmail;
  }

  afterEach(() => {
    vi.doUnmock('nodemailer');
    vi.clearAllMocks();
    for (const key of ['MAIL_HOST', 'MAIL_PORT']) delete process.env[key];
    process.env.MAIL_USER = '';
    process.env.MAIL_PASS = '';
  });

  it('sends through Gmail over TLS by default', async () => {
    sendMail.mockResolvedValue({ messageId: '<1@mountainhut>' });
    const send = await loadService({ MAIL_USER: 'hut@gmail.com', MAIL_PASS: 'secret' });

    const info = await send(sampleEmail);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'hut@gmail.com', pass: 'secret' },
    }));
    expect(sendMail).toHaveBeenCalledWith({ from: 'Mountain Hut <hut@gmail.com>', ...sampleEmail });
    expect(info.messageId).toBe('<1@mountainhut>');
  });

  it('uses the configured server, with STARTTLS on port 587', async () => {
    sendMail.mockResolvedValue({ messageId: '<2@mountainhut>' });
    const send = await loadService({ MAIL_USER: 'hut', MAIL_PASS: 'secret', MAIL_HOST: 'smtp.example.com', MAIL_PORT: '587' });

    await send(sampleEmail);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.com', port: 587, secure: false }));
  });

  it('rejects when the SMTP server refuses the email', async () => {
    sendMail.mockRejectedValue(new Error('Invalid login'));
    const send = await loadService({ MAIL_USER: 'hut@gmail.com', MAIL_PASS: 'wrong' });

    await expect(send(sampleEmail)).rejects.toThrow('Invalid login');
  });
});
