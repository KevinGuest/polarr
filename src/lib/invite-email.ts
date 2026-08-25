import {
  applyEmailTemplate,
  DEFAULT_EMAIL_TEMPLATES,
  escapeHtml,
  renderEmailTemplate,
  type EmailTemplateBody,
} from "@/lib/email-templates";

export type InviteEmailContent = {
  subject: string;
  text: string;
  html: string;
  joinUrl: string;
  serverName: string;
  from: string;
  code: string;
  expiresLabel: string;
};

export function inviteEmailVars(input: {
  code: string;
  joinUrl: string;
  serverName: string;
  invitedBy?: string;
  expiresAt?: string | null;
  from: string;
  logoUrl?: string;
}): Record<string, string> {
  const serverName = input.serverName.trim() || "Polarr";
  const expiresLabel = input.expiresAt
    ? new Date(input.expiresAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "in 14 days";
  const by = input.invitedBy?.trim() || "";
  return {
    serverName: escapeHtml(serverName),
    invitedBy: escapeHtml(by),
    invitedByClause: by ? ` by ${by}` : "",
    invitedByHtml: by
      ? ` by <strong style="color:#f4f4f5;">${escapeHtml(by)}</strong>`
      : "",
    joinUrl: escapeHtml(input.joinUrl),
    code: escapeHtml(input.code),
    expiresLabel: escapeHtml(expiresLabel),
    from: escapeHtml(input.from),
    logoUrl: input.logoUrl || "",
  };
}

/** Plain-text vars (no HTML escaping) for the text body / subject. */
export function inviteEmailPlainVars(input: {
  code: string;
  joinUrl: string;
  serverName: string;
  invitedBy?: string;
  expiresAt?: string | null;
  from: string;
  logoUrl?: string;
}): Record<string, string> {
  const serverName = input.serverName.trim() || "Polarr";
  const expiresLabel = input.expiresAt
    ? new Date(input.expiresAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "in 14 days";
  const by = input.invitedBy?.trim() || "";
  return {
    serverName,
    invitedBy: by,
    invitedByClause: by ? ` by ${by}` : "",
    invitedByHtml: by ? ` by ${by}` : "",
    joinUrl: input.joinUrl,
    code: input.code,
    expiresLabel,
    from: input.from,
    logoUrl: input.logoUrl || "",
  };
}

export function buildInviteEmail(
  input: {
    to: string;
    code: string;
    joinUrl: string;
    serverName: string;
    invitedBy?: string;
    expiresAt?: string | null;
    from: string;
    logoUrl?: string;
  },
  template: EmailTemplateBody = DEFAULT_EMAIL_TEMPLATES.invite,
): InviteEmailContent {
  const plain = inviteEmailPlainVars(input);
  const htmlSafe = {
    ...inviteEmailVars(input),
    joinUrl: escapeHtml(input.joinUrl),
    logoUrl: input.logoUrl || "",
  };
  return {
    subject: applyEmailTemplate(template.subject, plain),
    text: applyEmailTemplate(template.text, plain),
    html: applyEmailTemplate(template.html, htmlSafe),
    joinUrl: input.joinUrl,
    serverName: plain.serverName,
    from: input.from,
    code: input.code,
    expiresLabel: plain.expiresLabel,
  };
}

export { renderEmailTemplate, DEFAULT_EMAIL_TEMPLATES };
