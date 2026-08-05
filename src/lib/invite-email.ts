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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildInviteEmail(input: {
  to: string;
  code: string;
  joinUrl: string;
  serverName: string;
  invitedBy?: string;
  expiresAt?: string | null;
  from: string;
}): InviteEmailContent {
  const serverName = input.serverName.trim() || "Polarr";
  const expiresLabel = input.expiresAt
    ? new Date(input.expiresAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "in 14 days";
  const by = input.invitedBy?.trim();
  const subject = `You're invited to join ${serverName}`;
  const text = [
    `You've been invited${by ? ` by ${by}` : ""} to join ${serverName} on Polarr.`,
    "",
    `Open this link to create your account:`,
    input.joinUrl,
    "",
    `Invite code: ${input.code}`,
    `This invite expires ${expiresLabel}.`,
    "",
    "If you weren't expecting this, you can ignore this email.",
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
              <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#a1a1aa;">Polarr invite</p>
              <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;color:#fafafa;">Join ${escapeHtml(serverName)}</h1>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#a1a1aa;">
                You've been invited${by ? ` by <strong style="color:#f4f4f5;">${escapeHtml(by)}</strong>` : ""} to create an account on this Polarr homeserver.
              </p>
              <p style="margin:0 0 24px;">
                <a href="${escapeHtml(input.joinUrl)}" style="display:inline-block;background:#fafafa;color:#18181b;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px;">
                  Accept invite
                </a>
              </p>
              <p style="margin:0 0 6px;font-size:12px;color:#71717a;">Or use code</p>
              <p style="margin:0 0 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;letter-spacing:0.06em;color:#f4f4f5;">
                ${escapeHtml(input.code)}
              </p>
              <p style="margin:0;font-size:12px;color:#71717a;">Expires ${escapeHtml(expiresLabel)}.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject,
    text,
    html,
    joinUrl: input.joinUrl,
    serverName,
    from: input.from,
    code: input.code,
    expiresLabel,
  };
}
