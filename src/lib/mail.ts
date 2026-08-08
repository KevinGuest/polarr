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

/** Verify SMTP by sending a short message to a recipient (usually the server owner). */
export async function sendSmtpTestEmail(input: {
  to: string;
  recipientName?: string | null;
  /** Use form values without saving — otherwise current settings. */
  settings?: Settings;
}) {
  const settings = input.settings ?? getSettings();
  if (!smtpConfigured(settings)) {
    throw new Error("Email service has not been set up");
  }
  const to = input.to.trim();
  if (!to) throw new Error("No recipient email");
  const name = (input.recipientName || "").trim() || "admin";
  const server = settings.serverName.trim() || "Polarr";
  const subject = `${server} — SMTP test`;
  const text = [
    `Hi ${name},`,
    "",
    `This is a test message from ${server}.`,
    "If you received it, SMTP is configured correctly.",
    "",
    `Host: ${settings.smtpHost}`,
    `Port: ${settings.smtpPort}`,
    `From: ${settings.smtpFrom}`,
    `Secure: ${settings.smtpSecure ? "yes" : "no"}`,
  ].join("\n");
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>This is a test message from <strong>${escapeHtml(server)}</strong>.</p>
    <p>If you received it, SMTP is configured correctly.</p>
    <ul>
      <li>Host: ${escapeHtml(settings.smtpHost)}</li>
      <li>Port: ${settings.smtpPort}</li>
      <li>From: ${escapeHtml(settings.smtpFrom)}</li>
      <li>Secure: ${settings.smtpSecure ? "yes" : "no"}</li>
    </ul>
  `.trim();
  await transporter(settings).sendMail({
    from: settings.smtpFrom,
    to,
    subject,
    text,
    html,
  });
  return { to, subject };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
