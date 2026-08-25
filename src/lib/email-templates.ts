/**
 * Editable outbound email templates (SMTP).
 * Placeholders use {{name}} — unknown keys are left as-is.
 */

export type EmailTemplateId = "invite" | "smtpTest";

export type EmailTemplateBody = {
  subject: string;
  text: string;
  html: string;
};

export type EmailTemplatesMap = Record<EmailTemplateId, EmailTemplateBody>;

export const EMAIL_TEMPLATE_META: {
  id: EmailTemplateId;
  label: string;
  description: string;
  variables: { key: string; description: string }[];
}[] = [
  {
    id: "invite",
    label: "Invite",
    description: "Sent when an admin invites someone to join this server.",
    variables: [
      { key: "serverName", description: "Server display name" },
      { key: "invitedBy", description: "Inviter username (may be empty)" },
      { key: "invitedByClause", description: "“ by Name” or empty" },
      { key: "invitedByHtml", description: "HTML “ by Name” or empty" },
      { key: "joinUrl", description: "Accept-invite URL" },
      { key: "code", description: "Invite code" },
      { key: "expiresLabel", description: "Human expiry date" },
      { key: "from", description: "From address" },
      { key: "logoUrl", description: "Polarr logo image URL (cid or https)" },
    ],
  },
  {
    id: "smtpTest",
    label: "SMTP test",
    description: "Sent when you run Test connection on the SMTP page.",
    variables: [
      { key: "serverName", description: "Server display name" },
      { key: "recipientName", description: "Recipient display name" },
      { key: "host", description: "SMTP host" },
      { key: "port", description: "SMTP port" },
      { key: "from", description: "From address" },
      { key: "secure", description: "yes / no" },
      { key: "logoUrl", description: "Polarr logo image URL (cid or https)" },
    ],
  },
];

const LOGO_IMG = `<img src="{{logoUrl}}" width="48" height="48" alt="Polarr" style="display:block;width:48px;height:48px;border:0;border-radius:10px;margin:0 0 16px;" />`;

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplatesMap = {
  invite: {
    subject: "You're invited to join {{serverName}}",
    text: [
      "You've been invited{{invitedByClause}} to join {{serverName}} on Polarr.",
      "",
      "Open this link to create your account:",
      "{{joinUrl}}",
      "",
      "Invite code: {{code}}",
      "This invite expires {{expiresLabel}}.",
      "",
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0f0f12;color:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f0f12;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:480px;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:28px;">
          <tr>
            <td>
              ${LOGO_IMG}
              <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#a1a1aa;">Polarr invite</p>
              <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;color:#fafafa;">Join {{serverName}}</h1>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#a1a1aa;">
                You've been invited{{invitedByHtml}} to create an account on this Polarr homeserver.
              </p>
              <p style="margin:0 0 24px;">
                <a href="{{joinUrl}}" style="display:inline-block;background:#fafafa;color:#18181b;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px;">
                  Accept invite
                </a>
              </p>
              <p style="margin:0 0 6px;font-size:12px;color:#71717a;">Or use code</p>
              <p style="margin:0 0 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;letter-spacing:0.06em;color:#f4f4f5;">
                {{code}}
              </p>
              <p style="margin:0;font-size:12px;color:#71717a;">Expires {{expiresLabel}}.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },
  smtpTest: {
    subject: "{{serverName}} — SMTP test",
    text: [
      "Hi {{recipientName}},",
      "",
      "This is a test message from {{serverName}}.",
      "If you received it, SMTP is configured correctly.",
      "",
      "Host: {{host}}",
      "Port: {{port}}",
      "From: {{from}}",
      "Secure: {{secure}}",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0f0f12;color:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f0f12;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:480px;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:28px;">
          <tr>
            <td>
              ${LOGO_IMG}
              <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#a1a1aa;">SMTP test</p>
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.2;color:#fafafa;">{{serverName}}</h1>
              <p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#a1a1aa;">Hi {{recipientName}},</p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#a1a1aa;">
                This is a test message from <strong style="color:#f4f4f5;">{{serverName}}</strong>.
                If you received it, SMTP is configured correctly.
              </p>
              <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:#a1a1aa;">
                <li>Host: {{host}}</li>
                <li>Port: {{port}}</li>
                <li>From: {{from}}</li>
                <li>Secure: {{secure}}</li>
              </ul>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },
};

/** Content-ID for multipart/related logo (referenced as cid:polarr-logo). */
export const POLARR_LOGO_CID = "polarr-logo";

/** Public fallback when Public URL is unset (same as Discord webhook avatar). */
export const POLARR_LOGO_PUBLIC_URL =
  "https://raw.githubusercontent.com/KevinGuest/polarr/main/public/polarr-icon.png";

/** Sample values for the SMTP templates editor preview. */
export const EMAIL_TEMPLATE_SAMPLE_VARS: Record<
  EmailTemplateId,
  Record<string, string>
> = {
  invite: {
    serverName: "Polarr",
    invitedBy: "you",
    invitedByClause: " by you",
    invitedByHtml: ' by <strong style="color:#f4f4f5;">you</strong>',
    joinUrl: "https://polarr.local/join?code=POLARR-SAMPLE-CODE",
    code: "POLARR-SAMPLE-CODE",
    expiresLabel: "in 14 days",
    from: "polarr@example.com",
    logoUrl: POLARR_LOGO_PUBLIC_URL,
  },
  smtpTest: {
    serverName: "Polarr",
    recipientName: "admin",
    host: "smtp.example.com",
    port: "587",
    from: "polarr@example.com",
    secure: "no",
    logoUrl: POLARR_LOGO_PUBLIC_URL,
  },
};

export function isEmailTemplateId(raw: string): raw is EmailTemplateId {
  return raw === "invite" || raw === "smtpTest";
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Replace {{key}} tokens. Values are inserted as-is (pre-escape HTML vars yourself). */
export function applyEmailTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key] ?? "";
    }
    return match;
  });
}

export function renderEmailTemplate(
  body: EmailTemplateBody,
  vars: Record<string, string>,
): { subject: string; text: string; html: string } {
  return {
    subject: applyEmailTemplate(body.subject, vars),
    text: applyEmailTemplate(body.text, vars),
    html: applyEmailTemplate(body.html, vars),
  };
}

export function mergeEmailTemplates(
  stored: Partial<Record<EmailTemplateId, Partial<EmailTemplateBody>>> | null | undefined,
): EmailTemplatesMap {
  const out: EmailTemplatesMap = {
    invite: { ...DEFAULT_EMAIL_TEMPLATES.invite },
    smtpTest: { ...DEFAULT_EMAIL_TEMPLATES.smtpTest },
  };
  if (!stored) return out;
  for (const id of Object.keys(out) as EmailTemplateId[]) {
    const patch = stored[id];
    if (!patch) continue;
    if (typeof patch.subject === "string") out[id].subject = patch.subject;
    if (typeof patch.text === "string") out[id].text = patch.text;
    if (typeof patch.html === "string") out[id].html = patch.html;
  }
  return out;
}

export function parseEmailTemplatesJson(
  raw: string | null | undefined,
): EmailTemplatesMap {
  if (!raw?.trim()) return mergeEmailTemplates(null);
  try {
    const parsed = JSON.parse(raw) as Partial<
      Record<EmailTemplateId, Partial<EmailTemplateBody>>
    >;
    return mergeEmailTemplates(parsed);
  } catch {
    return mergeEmailTemplates(null);
  }
}

/** Only store fields that differ from defaults (keeps settings small). */
export function serializeEmailTemplateOverrides(
  templates: EmailTemplatesMap,
): string {
  const overrides: Partial<
    Record<EmailTemplateId, Partial<EmailTemplateBody>>
  > = {};
  for (const id of Object.keys(DEFAULT_EMAIL_TEMPLATES) as EmailTemplateId[]) {
    const def = DEFAULT_EMAIL_TEMPLATES[id];
    const cur = templates[id];
    const patch: Partial<EmailTemplateBody> = {};
    if (cur.subject !== def.subject) patch.subject = cur.subject;
    if (cur.text !== def.text) patch.text = cur.text;
    if (cur.html !== def.html) patch.html = cur.html;
    if (Object.keys(patch).length) overrides[id] = patch;
  }
  return JSON.stringify(overrides);
}
