import nodemailer from "nodemailer";
import {
  brandLogoAttachment,
  emailFromAddress,
  emailLogoSrc,
} from "@/lib/brand-logo";
import {
  getEmailTemplates,
  getSettings,
  smtpConfigured,
  type Settings,
} from "@/lib/db";
import { buildInviteEmail } from "@/lib/invite-email";
import { applyEmailTemplate, escapeHtml } from "@/lib/email-templates";

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

function mailAttachments() {
  const logo = brandLogoAttachment();
  return logo ? [logo] : undefined;
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
  const templates = getEmailTemplates();
  const content = buildInviteEmail(
    {
      to: input.to,
      code: input.code,
      joinUrl: input.joinUrl,
      serverName: settings.serverName,
      invitedBy: input.invitedBy,
      expiresAt: input.expiresAt,
      from: settings.smtpFrom,
      logoUrl: emailLogoSrc({ settings }),
    },
    templates.invite,
  );
  await transporter(settings).sendMail({
    from: emailFromAddress(settings),
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: mailAttachments(),
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
  const template = getEmailTemplates().smtpTest;
  const logoUrl = emailLogoSrc({ settings });
  const plain = {
    serverName: server,
    recipientName: name,
    host: settings.smtpHost,
    port: String(settings.smtpPort),
    from: settings.smtpFrom,
    secure: settings.smtpSecure ? "yes" : "no",
    logoUrl,
  };
  const htmlVars = {
    serverName: escapeHtml(server),
    recipientName: escapeHtml(name),
    host: escapeHtml(settings.smtpHost),
    port: String(settings.smtpPort),
    from: escapeHtml(settings.smtpFrom),
    secure: settings.smtpSecure ? "yes" : "no",
    logoUrl,
  };
  const subject = applyEmailTemplate(template.subject, plain);
  const text = applyEmailTemplate(template.text, plain);
  const html = applyEmailTemplate(template.html, htmlVars);
  await transporter(settings).sendMail({
    from: emailFromAddress(settings),
    to,
    subject,
    text,
    html,
    attachments: mailAttachments(),
  });
  return { to, subject };
}
