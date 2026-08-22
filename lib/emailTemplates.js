// Shared HTML for transactional emails sent through Resend (see
// app/api/send-verification-email/route.js). Kept intentionally simple —
// a single branded header, one message, one button — since that's both the
// easiest to get right across email clients and the least likely to trip
// spam filters (heavy layouts/images are a common spam signal).

const BRAND_GRADIENT = "linear-gradient(100deg, #28bfac 0%, #2159d4 100%)";

export function verificationEmailHtml({ link }) {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:${BRAND_GRADIENT};padding:28px 32px;">
                <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">bizzux</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Verify your email</h1>
                <p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#475569;">
                  Thanks for signing up for Bizzux. Confirm this is your email address to finish setting up your account.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:999px;background:${BRAND_GRADIENT};">
                      <a href="${link}" style="display:inline-block;padding:12px 28px;font-size:14.5px;font-weight:700;color:#ffffff;text-decoration:none;">
                        Verify email
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:12.5px;line-height:1.6;color:#94a3b8;">
                  If the button doesn't work, copy and paste this link into your browser:<br />
                  <a href="${link}" style="color:#2159d4;word-break:break-all;">${link}</a>
                </p>
                <p style="margin:20px 0 0;font-size:12.5px;line-height:1.6;color:#94a3b8;">
                  If you didn't create a Bizzux account, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
