import { z } from "zod";
import { getAdminUser, json } from "@/lib/api";
import { getEmailTemplates, saveEmailTemplates } from "@/lib/db";
import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_META,
  EMAIL_TEMPLATE_SAMPLE_VARS,
  isEmailTemplateId,
  type EmailTemplateBody,
  type EmailTemplateId,
  type EmailTemplatesMap,
} from "@/lib/email-templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  return json({
    templates: getEmailTemplates(),
    defaults: DEFAULT_EMAIL_TEMPLATES,
    meta: EMAIL_TEMPLATE_META,
    samples: EMAIL_TEMPLATE_SAMPLE_VARS,
  });
}

const bodySchema = z.object({
  templates: z.record(
    z.string(),
    z.object({
      subject: z.string().max(300),
      text: z.string().max(20_000),
      html: z.string().max(100_000),
    }),
  ),
});

export async function PUT(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid templates payload" }, { status: 400 });
  }

  const next: EmailTemplatesMap = {
    invite: { ...DEFAULT_EMAIL_TEMPLATES.invite },
    smtpTest: { ...DEFAULT_EMAIL_TEMPLATES.smtpTest },
  };

  for (const [key, body] of Object.entries(parsed.data.templates)) {
    if (!isEmailTemplateId(key)) continue;
    const id = key as EmailTemplateId;
    const patch = body as EmailTemplateBody;
    if (!patch.subject.trim()) {
      return json({ error: `${id}: subject is required` }, { status: 400 });
    }
    next[id] = {
      subject: patch.subject,
      text: patch.text,
      html: patch.html,
    };
  }

  const templates = saveEmailTemplates(next);
  return json({ templates, defaults: DEFAULT_EMAIL_TEMPLATES });
}
