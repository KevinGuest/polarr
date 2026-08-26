import {
  brandLogoAttachment,
  emailFromAddress,
  emailLogoSrc,
} from "@/lib/brand-logo";
import { escapeHtml } from "@/lib/email-templates";
import { getSettings, smtpConfigured, type Settings } from "@/lib/db";
import nodemailer from "nodemailer";

function transporter(settings: Settings) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth:
      settings.smtpUser || settings.smtpPassword
        ? {
            user: settings.smtpUser,
            pass: settings.smtpPassword,
          }
        : undefined,
  });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  username: string;
  resetUrl: string;
}) {
  const settings = getSettings();
  if (!smtpConfigured(settings)) {
    throw new Error("Email service has not been set up");
  }
  const server = settings.serverName.trim() || "Polarr";
  const name = input.username.trim() || "there";
  const logoUrl = emailLogoSrc({ settings });
  const subject = `${server} — reset your password`;
  const text = [
    `Hi ${name},`,
    "",
    `Someone requested a password reset for your ${server} account.`,
    "Open this link to choose a new password (expires in 1 hour):",
    "",
    input.resetUrl,
    "",
    "If you didn’t ask for this, you can ignore this email.",
  ].join("\n");
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0f0f12;color:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f0f12;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:480px;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:28px;">
          <tr>
            <td>
              <img src="${escapeHtml(logoUrl)}" width="48" height="48" alt="Polarr" style="display:block;width:48px;height:48px;border:0;border-radius:10px;margin:0 0 16px;" />
              <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#a1a1aa;">Password reset</p>
              <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;color:#fafafa;">Reset your password</h1>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#a1a1aa;">
                Hi ${escapeHtml(name)}, someone requested a password reset for your
                <strong style="color:#f4f4f5;">${escapeHtml(server)}</strong> account.
              </p>
              <p style="margin:0 0 24px;">
                <a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;background:#fafafa;color:#18181b;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px;">
                  Choose a new password
                </a>
              </p>
              <p style="margin:0;font-size:12px;color:#71717a;">This link expires in 1 hour. If you didn’t ask for this, ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const logo = brandLogoAttachment();
  await transporter(settings).sendMail({
    from: emailFromAddress(settings),
    to: input.to,
    subject,
    text,
    html,
    attachments: logo ? [logo] : undefined,
  });
}
