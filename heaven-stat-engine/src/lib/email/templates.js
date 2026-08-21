/**
 * Email templates for Heaven Stat Engine
 */

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

function getWordmarkUrl() {
  const baseUrl = getAppUrl().replace(/\/$/, '');
  return `${baseUrl}/brand/03_wordmark_only.png`;
}

function emailWrapper(content) {
  const wordmarkUrl = getWordmarkUrl();
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Heaven Stat Engine</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0B0E14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #E2E8F0;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0B0E14; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #121824; border: 1px solid rgba(201, 168, 76, 0.3); border-radius: 16px; overflow: hidden; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);">
          <!-- Header with Wordmark -->
          <tr>
            <td align="center" style="padding: 36px 30px 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: linear-gradient(180deg, rgba(201, 168, 76, 0.08) 0%, rgba(18, 24, 36, 0) 100%);">
              <img src="${wordmarkUrl}" alt="Heaven Stat Engine" width="180" style="display: block; max-width: 180px; height: auto;" />
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 30px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 20px 30px; border-top: 1px solid rgba(255, 255, 255, 0.06); background-color: #0E131D;">
              <p style="margin: 0; font-size: 12px; color: #64748B;">
                Heaven Stat Engine · Private Esports Analytics
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Template for new user added to platform
 */
export function buildPlatformInviteEmail({ toEmail, tempPassword, role = 'operator' }) {
  const baseUrl = getAppUrl().replace(/\/$/, '');
  const loginUrl = `${baseUrl}/login?redirect=${encodeURIComponent('/dashboard')}`;

  const content = `
    <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #F1F5F9;">
      Welcome to Heaven Stat Engine
    </h2>
    <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #94A3B8;">
      You have been granted <strong style="color: #C9A84C;">${role === 'owner' ? 'Owner' : 'Operator'}</strong> access to the Heaven Stat Engine platform.
    </p>

    <div style="background-color: #0A0D14; border: 1px solid rgba(201, 168, 76, 0.35); border-radius: 10px; padding: 18px 20px; margin-bottom: 24px;">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #94A3B8; margin-bottom: 6px; font-weight: 600;">
        Your Temporary Password
      </div>
      <div style="font-family: monospace, Courier, 'Courier New'; font-size: 18px; font-weight: 700; color: #C9A84C; letter-spacing: 0.08em; word-break: break-all;">
        ${tempPassword}
      </div>
    </div>

    <p style="margin: 0 0 24px; font-size: 13px; color: #94A3B8; line-height: 1.5;">
      ⚠️ For security, you will be prompted to update your password immediately after your first sign-in.
    </p>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 8px;">
      <tr>
        <td align="center">
          <a href="${loginUrl}" target="_blank" style="display: inline-block; background: linear-space, #C9A84C; background-color: #C9A84C; color: #000000; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 8px; box-shadow: 0 4px 14px rgba(201, 168, 76, 0.35);">
            Sign In to Heaven
          </a>
        </td>
      </tr>
    </table>
  `;

  return {
    subject: 'Welcome to Heaven Stat Engine — Access Granted',
    html: emailWrapper(content),
  };
}

/**
 * Template for tournament collaborator invite
 */
export function buildTournamentInviteEmail({ toEmail, tournamentName, tournamentId }) {
  const baseUrl = getAppUrl().replace(/\/$/, '');
  const destination = `/tournaments/${tournamentId}`;
  const loginUrl = `${baseUrl}/login?redirect=${encodeURIComponent(destination)}`;

  const content = `
    <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #F1F5F9;">
      Tournament Collaboration Invite
    </h2>
    <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #94A3B8;">
      You have been added as an editor for tournament <strong style="color: #C9A84C;">${tournamentName}</strong> on Heaven Stat Engine.
    </p>

    <div style="background-color: #0A0D14; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 18px 20px; margin-bottom: 24px;">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #94A3B8; margin-bottom: 4px; font-weight: 600;">
        Tournament
      </div>
      <div style="font-size: 16px; font-weight: 700; color: #FFFFFF;">
        ${tournamentName}
      </div>
    </div>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 8px;">
      <tr>
        <td align="center">
          <a href="${loginUrl}" target="_blank" style="display: inline-block; background-color: #C9A84C; color: #000000; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 8px; box-shadow: 0 4px 14px rgba(201, 168, 76, 0.35);">
            Open Tournament
          </a>
        </td>
      </tr>
    </table>
  `;

  return {
    subject: `You were invited to edit "${tournamentName}" on Heaven Stat Engine`,
    html: emailWrapper(content),
  };
}
