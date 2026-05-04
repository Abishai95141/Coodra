'use server';

import { runInit } from '@coodra/contextos-cli/lib/init';
import { runPackDelete, runPackRegenerate } from '@coodra/contextos-cli/lib/pack';
import { redirect } from 'next/navigation';
import { z } from 'zod';

/**
 * `apps/web/lib/actions/packs.ts` — Server Actions for the pack
 * mutation surface (M04 Phase 2 S5).
 *
 * Three actions, all reachable from the action bar on
 * `/projects/[slug]/packs/[packSlug]`:
 *
 *   regeneratePackAction(formData)  — single yes/no confirmation;
 *                                     wraps `runPackRegenerate` from
 *                                     the CLI library promotion.
 *
 *   deletePackAction(formData)      — typed-confirm "delete <slug>";
 *                                     wraps `runPackDelete`. Per
 *                                     OQ-7 lock (S5 default): hard-
 *                                     deletes the on-disk dir AND
 *                                     soft-flips feature_packs.
 *                                     is_active = false (matches the
 *                                     real CLI behaviour).
 *
 *   installTemplateAction(formData) — typed-confirm "install <name>";
 *                                     wraps `runInit({mode:'default',
 *                                     template:<name>, force:true})`
 *                                     to overlay a template on the
 *                                     existing pack.
 *
 * Form-side validation re-uses the CLI's slug regex. Failures
 * redirect with `?error=&errorMessage=` so the page can re-render the
 * action bar with an inline banner. Successes redirect to the pack
 * list (delete) or back to the pack detail (regen / install) with a
 * success banner.
 *
 * Why all three live in one file: they share the Zod schemas,
 * redirect helpers, and project-scope plumbing. Keeping them in a
 * single module keeps imports simple in the page.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9_-]+$/;

const COMMON_FIELDS = z.object({
  projectSlug: z.string().min(1).regex(SLUG_RE),
  packSlug: z.string().min(1).regex(SLUG_RE),
  cwd: z
    .string()
    .min(1, 'cwd is required')
    .refine((v) => v.startsWith('/'), 'cwd must be an absolute path'),
});

const REGEN_SCHEMA = COMMON_FIELDS.extend({
  confirm: z.string().refine((v) => v === 'yes', 'Tick the confirm box to regenerate.'),
});

const DELETE_SCHEMA = COMMON_FIELDS.extend({
  confirmation: z.string().min(1, 'Type the confirmation phrase to delete.'),
});

const INSTALL_SCHEMA = COMMON_FIELDS.extend({
  templateName: z
    .string()
    .min(1, 'Pick a template to install.')
    .regex(/^[a-z0-9-]+$/, 'Template name must be lowercase letters, digits, hyphens.'),
  confirmation: z.string().min(1, 'Type the confirmation phrase to install.'),
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function regeneratePackAction(formData: FormData): Promise<void> {
  const raw = {
    projectSlug: String(formData.get('projectSlug') ?? ''),
    packSlug: String(formData.get('packSlug') ?? ''),
    cwd: String(formData.get('cwd') ?? ''),
    confirm: String(formData.get('confirm') ?? ''),
  };
  const parsed = REGEN_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    redirect(packDetailHref(raw.projectSlug, raw.packSlug, 'regen_validation_failed', firstZodMessage(parsed.error)));
  }
  const result = await runPackRegenerate({
    slug: parsed.data.packSlug,
    cwd: parsed.data.cwd,
    mode: 'default',
  });
  if (!result.ok) {
    redirect(packDetailHref(parsed.data.projectSlug, parsed.data.packSlug, result.error, result.howToFix));
  }
  redirect(`${packDetailBase(parsed.data.projectSlug, parsed.data.packSlug)}?regenerated=1`);
}

export async function deletePackAction(formData: FormData): Promise<void> {
  const raw = {
    projectSlug: String(formData.get('projectSlug') ?? ''),
    packSlug: String(formData.get('packSlug') ?? ''),
    cwd: String(formData.get('cwd') ?? ''),
    confirmation: String(formData.get('confirmation') ?? ''),
  };
  const parsed = DELETE_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    redirect(packDetailHref(raw.projectSlug, raw.packSlug, 'delete_validation_failed', firstZodMessage(parsed.error)));
  }
  const expectedConfirm = `delete ${parsed.data.packSlug}`;
  if (parsed.data.confirmation !== expectedConfirm) {
    redirect(
      packDetailHref(
        parsed.data.projectSlug,
        parsed.data.packSlug,
        'delete_confirmation_mismatch',
        `Confirmation phrase must be "${expectedConfirm}" exactly.`,
      ),
    );
  }
  const result = await runPackDelete({
    slug: parsed.data.packSlug,
    cwd: parsed.data.cwd,
  });
  if (!result.ok) {
    redirect(packDetailHref(parsed.data.projectSlug, parsed.data.packSlug, result.error, result.howToFix));
  }
  // Pack is gone — redirect to the project's pack list with a banner.
  redirect(
    `/projects/${encodeURIComponent(parsed.data.projectSlug)}/packs?deleted=${encodeURIComponent(parsed.data.packSlug)}`,
  );
}

export async function installTemplateAction(formData: FormData): Promise<void> {
  const raw = {
    projectSlug: String(formData.get('projectSlug') ?? ''),
    packSlug: String(formData.get('packSlug') ?? ''),
    cwd: String(formData.get('cwd') ?? ''),
    templateName: String(formData.get('templateName') ?? ''),
    confirmation: String(formData.get('confirmation') ?? ''),
  };
  const parsed = INSTALL_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    redirect(packDetailHref(raw.projectSlug, raw.packSlug, 'install_validation_failed', firstZodMessage(parsed.error)));
  }
  const expectedConfirm = `install ${parsed.data.templateName}`;
  if (parsed.data.confirmation !== expectedConfirm) {
    redirect(
      packDetailHref(
        parsed.data.projectSlug,
        parsed.data.packSlug,
        'install_confirmation_mismatch',
        `Confirmation phrase must be "${expectedConfirm}" exactly.`,
      ),
    );
  }
  // Template overlay = init with --force + the template selector. The
  // pack's existing user-edited content (outside auto-marker sections)
  // is preserved by the seedFeaturePack merge logic.
  const result = await runInit({
    cwd: parsed.data.cwd,
    projectSlug: parsed.data.packSlug,
    ide: 'claude',
    noGraphify: true,
    template: parsed.data.templateName,
    mode: 'default',
    force: true,
  });
  if (!result.ok) {
    redirect(packDetailHref(parsed.data.projectSlug, parsed.data.packSlug, result.error, result.howToFix));
  }
  redirect(
    `${packDetailBase(parsed.data.projectSlug, parsed.data.packSlug)}?installed=${encodeURIComponent(parsed.data.templateName)}`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function packDetailBase(projectSlug: string, packSlug: string): string {
  return `/projects/${encodeURIComponent(projectSlug)}/packs/${encodeURIComponent(packSlug)}`;
}

function packDetailHref(projectSlug: string, packSlug: string, errorCode: string, message: string): string {
  const search = new URLSearchParams();
  search.set('error', errorCode);
  search.set('errorMessage', message);
  return `${packDetailBase(projectSlug, packSlug)}?${search.toString()}`;
}

function firstZodMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  if (issue === undefined) return 'invalid form data';
  const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  return `${path}${issue.message}`;
}
