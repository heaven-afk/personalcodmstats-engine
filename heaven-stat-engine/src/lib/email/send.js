/**
 * Universal Email Sender for Heaven Stat Engine
 * Supports:
 * 1. Gmail / Custom SMTP (zero custom domain needed - uses your dedicated project email + Google app password)
 * 2. Resend API (if RESEND_API_KEY is configured)
 */
export async function sendEmail({ to, subject, html }) {
  const recipients = Array.isArray(to) ? to : [to];

  // ─── 1. Gmail / Custom SMTP Delivery ───────────────────────────────────────
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpUser && smtpPass) {
    try {
      // Dynamic import keeps nodemailer out of the module-level bundle
      const nodemailer = (await import('nodemailer')).default;

      const port = parseInt(process.env.SMTP_PORT || '465', 10);
      const isSecure = port === 465;

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure: isSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const fromAddress = process.env.SMTP_FROM || `Heaven Stat Engine <${smtpUser}>`;

      const info = await transporter.sendMail({
        from: fromAddress,
        to: recipients.join(', '),
        subject,
        html,
      });

      return { success: true, data: { id: info.messageId, provider: 'smtp' } };
    } catch (smtpErr) {
      console.error('[Email Service] SMTP error:', smtpErr);
      return { success: false, error: smtpErr.message || smtpErr };
    }
  }

  // ─── 2. Resend API Delivery ────────────────────────────────────────────────
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    let from = process.env.RESEND_FROM_EMAIL;
    if (!from || from.includes('yourdomain.com') || from.includes('noreply@resend.dev')) {
      from = 'Heaven Stat Engine <onboarding@resend.dev>';
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from,
          to: recipients,
          subject,
          html,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('[Email Service] Resend error:', data);
        return { success: false, error: data };
      }

      return { success: true, data: { ...data, provider: 'resend' } };
    } catch (err) {
      console.error('[Email Service] Failed to send email via Resend:', err);
      return { success: false, error: err.message };
    }
  }

  // ─── 3. No Provider Configured ─────────────────────────────────────────────
  console.warn('[Email Service] Neither SMTP (SMTP_USER/SMTP_PASS) nor Resend (RESEND_API_KEY) configured. Email skipped for:', to);
  return { success: false, skipped: true, reason: 'No email service configured' };
}
