import nodemailer from "nodemailer";
import { emailFromAddress } from "@/lib/brand-logo";
import { getSettings, smtpConfigured } from "@/lib/db";
import { escapeHtml } from "@/lib/email-templates";

export async function sendEmailChangeConfirmation(input: {
  to: string;
  username: string;
  confirmUrl: string;
}) {
  const settings = getSettings();
  if (!smtpConfigured(settings)) {
    throw new Error("Email service has not been set up");
  }
  const server = settings.serverName.trim() || "Polarr";
  const transport = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth:
      settings.smtpUser || settings.smtpPassword
        ? { user: settings.smtpUser, pass: settings.smtpPassword }
        : undefined,
  });
  await transport.sendMail({
    from: emailFromAddress(settings),
    to: input.to,
    subject: `${server} — confirm your new email`,
    text: [
      `Hi ${input.username || "there"},`,
      "",
      `Confirm this email address for your ${server} account:`,
      input.confirmUrl,
      "",
      "This link expires in one hour. If you did not request this, ignore it.",
    ].join("\n"),
    html: `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#0f0f12;color:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,sans-serif"><div style="max-width:480px;margin:auto;padding:28px;border:1px solid #27272a;border-radius:12px;background:#18181b"><p style="margin:0 0 8px;color:#a1a1aa;font-size:12px;letter-spacing:.14em;text-transform:uppercase">Email confirmation</p><h1 style="margin:0 0 12px;font-size:24px">Confirm your new email</h1><p style="margin:0 0 22px;color:#a1a1aa;line-height:1.5">Hi ${escapeHtml(input.username || "there")}, confirm this address for your ${escapeHtml(server)} account.</p><a href="${escapeHtml(input.confirmUrl)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#fafafa;color:#18181b;text-decoration:none;font-weight:600">Confirm email</a><p style="margin:22px 0 0;color:#71717a;font-size:12px">This link expires in one hour. If you did not request this, ignore it.</p></div></body></html>`,
  });
}
