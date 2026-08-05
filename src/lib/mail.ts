import nodemailer from "nodemailer";
import { getSettings, smtpConfigured, type Settings } from "@/lib/db";
import { buildInviteEmail } from "@/lib/invite-email";

export { buildInviteEmail } from "@/lib/invite-email";

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

export async function sendInviteEmail(input: {
  to: string;
  code: string;
  joinUrl: string;
  invitedBy?: string;
  expiresAt?: string | null;
}) {
  const settings = getSettings();
  if (!smtpConfigured(settings)) {
    throw new Error("Email service has not been set up");
  }
  const content = buildInviteEmail({
    to: input.to,
    code: input.code,
    joinUrl: input.joinUrl,
    serverName: settings.serverName,
    invitedBy: input.invitedBy,
    expiresAt: input.expiresAt,
    from: settings.smtpFrom,
  });
  await transporter(settings).sendMail({
    from: settings.smtpFrom,
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
  return content;
}
