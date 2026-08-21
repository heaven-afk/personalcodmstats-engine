/**
 * Resend email sending service
 */

export async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  let from = process.env.RESEND_FROM_EMAIL;
  
  // If no custom domain or unconfigured placeholder, use Resend's default onboarding address
  if (!from || from.includes('yourdomain.com') || from.includes('noreply@resend.dev')) {
    from = 'Heaven Stat Engine <onboarding@resend.dev>';
  }

  if (!apiKey) {
    console.warn('[Email Service] RESEND_API_KEY is not configured. Email skipped for:', to);
    return { success: false, skipped: true, reason: 'RESEND_API_KEY not configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Email Service] Resend error:', data);
      return { success: false, error: data };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[Email Service] Failed to send email:', err);
    return { success: false, error: err.message };
  }
}
