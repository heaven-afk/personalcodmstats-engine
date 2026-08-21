import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/send';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const body = await req.json();
    const { to } = body;

    if (!to) {
      return NextResponse.json({ error: 'Recipient email is required' }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: 'RESEND_API_KEY is not set in environment variables.',
      }, { status: 400 });
    }

    const htmlContent = `
      <div style="font-family: sans-serif; background: #0B0E14; color: #E2E8F0; padding: 32px; border-radius: 12px; max-width: 500px; margin: 0 auto; border: 1px solid #1E293B;">
        <h2 style="color: #C9A84C; margin-top: 0;">⚡ Heaven Stat Engine — Email Test</h2>
        <p style="font-size: 15px; line-height: 1.5; color: #94A3B8;">
          This is a test email confirming that your <strong>Resend API connection</strong> is functioning properly.
        </p>
        <div style="background: #121824; padding: 14px; border-radius: 8px; border: 1px solid #334155; font-size: 13px; font-family: monospace; color: #10B981; margin: 20px 0;">
          Status: 200 OK — Delivery Confirmed
        </div>
        <p style="font-size: 12px; color: #64748B; margin-bottom: 0;">
          Heaven Stat Engine · Private Access Only
        </p>
      </div>
    `;

    const result = await sendEmail({
      to,
      subject: '⚡ Heaven Stat Engine — Test Email',
      html: htmlContent,
    });

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error || 'Failed to dispatch email via Resend',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Test email successfully dispatched to ${to}! Check your inbox and spam folder.`,
      data: result.data,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
