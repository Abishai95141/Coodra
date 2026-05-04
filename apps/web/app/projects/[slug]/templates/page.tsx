import { StatusChip } from '@/components/StatusChip';
import { installTemplateFromPathAction } from '@/lib/actions/templates';
import { resolveProjectFromParams } from '@/lib/project-context';
import { listTemplates } from '@/lib/queries/templates';

/**
 * `/projects/[slug]/templates` — bundled + user-installed feature-pack
 * templates available for installation into this project (M04 Phase 2
 * S2a IA migration; install action added in S13).
 *
 * Templates are workspace-level (bundled with the CLI + ~/.contextos/
 * templates/) — the listing is the same for every project, but the
 * "Install" action targets THIS project's slug for the redirect /
 * banner so the operator sees the result in context.
 */
export const dynamic = 'force-dynamic';

interface SearchParams {
  readonly installed?: string;
  readonly error?: string;
  readonly errorMessage?: string;
}

export default async function TemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const project = await resolveProjectFromParams(params);
  const sp = await searchParams;
  const templates = listTemplates();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-black uppercase tracking-wide">Templates</h1>
        <p className="text-sm text-(--color-text-secondary)">
          Bundled + user templates available to <span className="font-mono">{project.slug}</span>. Install a custom one
          via the form below or use <span className="font-mono">contextos template install &lt;path&gt;</span> from the
          CLI.
        </p>
      </header>

      <Banners {...sp} />

      <InstallForm projectSlug={project.slug} />

      {templates.length === 0 ? (
        <div className="border border-(--color-border-subtle) bg-(--color-bg-surface) p-12 text-center">
          <p className="font-display text-lg font-light uppercase tracking-wider text-(--color-text-secondary)">
            No templates available.
          </p>
          <p className="mt-2 text-sm text-(--color-text-tertiary)">Install one with the form above or via the CLI.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {templates.map((t) => (
            <TemplateCard key={t.name} {...t} />
          ))}
        </div>
      )}
    </div>
  );
}

function InstallForm({ projectSlug }: { readonly projectSlug: string }) {
  return (
    <details className="border border-(--color-border-subtle) bg-(--color-bg-surface) p-4">
      <summary className="cursor-pointer font-display text-sm font-bold uppercase tracking-wider text-(--color-text-primary)">
        + Install a template from a local path
      </summary>
      <form action={installTemplateFromPathAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="projectSlug" value={projectSlug} />
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-display font-bold uppercase tracking-wider text-(--color-text-secondary)">
            Source path (absolute)
          </span>
          <input
            type="text"
            name="source"
            required
            placeholder="/Users/you/path/to/template-dir"
            className="border border-(--color-border-default) bg-(--color-bg-base) px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-display font-bold uppercase tracking-wider text-(--color-text-secondary)">
            Name override (optional)
          </span>
          <input
            type="text"
            name="name"
            placeholder="e.g. my-custom-template"
            pattern="[a-z0-9-]*"
            className="border border-(--color-border-default) bg-(--color-bg-base) px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="force" />
          <span className="font-display font-bold uppercase tracking-wider text-(--color-text-secondary)">
            Force overwrite if a user template with this name exists
          </span>
        </label>
        <p className="text-xs text-(--color-text-tertiary)">
          Source directory must contain <span className="font-mono">template.json</span>,{' '}
          <span className="font-mono">spec.md.tmpl</span>, <span className="font-mono">implementation.md.tmpl</span>,{' '}
          <span className="font-mono">techstack.md.tmpl</span>, and <span className="font-mono">meta.json.tmpl</span>.
          Bundled-template names are reserved — use a name override.
        </p>
        <button
          type="submit"
          className="self-start bg-(--color-brand) px-6 py-2 font-display text-xs font-bold uppercase tracking-wider text-white hover:bg-(--color-brand-hover)"
        >
          Install
        </button>
      </form>
    </details>
  );
}

function TemplateCard({
  name,
  source,
  dir,
  description,
  version,
  languages,
  autoSections,
}: {
  readonly name: string;
  readonly source: 'bundled' | 'user';
  readonly dir: string;
  readonly description: string | null;
  readonly version: string | null;
  readonly languages: ReadonlyArray<string>;
  readonly autoSections: ReadonlyArray<string>;
}) {
  return (
    <article className="flex flex-col gap-2 border border-(--color-border-subtle) bg-(--color-bg-surface) p-6">
      <div className="flex items-baseline gap-3">
        <h2 className="font-mono text-xl font-medium text-(--color-text-primary)">{name}</h2>
        <StatusChip status={source === 'bundled' ? 'info' : 'neutral'}>{source}</StatusChip>
        {version !== null ? <span className="font-mono text-xs text-(--color-text-tertiary)">v{version}</span> : null}
      </div>
      {description !== null ? <p className="text-sm text-(--color-text-secondary)">{description}</p> : null}
      <dl className="grid grid-cols-1 gap-1 text-xs md:grid-cols-2">
        <Field label="Languages" value={languages.length > 0 ? languages.join(', ') : '—'} />
        <Field label="@auto sections" value={autoSections.length > 0 ? autoSections.join(', ') : '—'} />
        <Field label="Path" value={<span className="font-mono">{dir}</span>} full />
      </dl>
    </article>
  );
}

function Field({
  label,
  value,
  full,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly full?: boolean;
}) {
  return (
    <div className={`flex gap-2 ${full === true ? 'md:col-span-2' : ''}`}>
      <dt className="font-display text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">
        {label}:
      </dt>
      <dd className="text-(--color-text-secondary)">{value}</dd>
    </div>
  );
}

function Banners(sp: SearchParams) {
  return (
    <div className="flex flex-col gap-2">
      {sp.installed !== undefined ? (
        <Banner kind="success">
          ✓ Installed template <span className="font-mono">{sp.installed}</span>.
        </Banner>
      ) : null}
      {sp.error !== undefined ? (
        <Banner kind="error">
          ✕ <span className="font-mono">{sp.error}</span>
          {sp.errorMessage !== undefined ? <span className="ml-2">{sp.errorMessage}</span> : null}
        </Banner>
      ) : null}
    </div>
  );
}

function Banner({ kind, children }: { readonly kind: 'success' | 'error'; readonly children: React.ReactNode }) {
  const colors = {
    success: 'border-(--color-status-success) bg-(--color-status-success)/10',
    error: 'border-(--color-status-error) bg-(--color-status-error)/10',
  } as const;
  return <div className={`border-l-4 ${colors[kind]} px-4 py-2 text-sm`}>{children}</div>;
}
