import { StatusChip } from '@/components/StatusChip';
import { resolveProjectFromParams } from '@/lib/project-context';
import { listTemplates } from '@/lib/queries/templates';

/**
 * `/projects/[slug]/templates` — bundled + user-installed feature-pack
 * templates available for installation into this project (M04 Phase 2
 * S2a IA migration).
 *
 * Templates are workspace-level (bundled with the CLI + ~/.contextos/
 * templates/) — the listing is the same for every project, but the
 * "Install" action (S13) targets THIS project specifically.
 */
export const dynamic = 'force-dynamic';

export default async function TemplatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const project = await resolveProjectFromParams(params);
  const templates = listTemplates();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-black uppercase tracking-wide">Templates</h1>
        <p className="text-sm text-(--color-text-secondary)">
          Bundled + user templates available to <span className="font-mono">{project.slug}</span>. Install via S13 (web)
          or <span className="font-mono">contextos template install &lt;path&gt;</span> (CLI).
        </p>
      </header>

      {templates.length === 0 ? (
        <div className="border border-(--color-border-subtle) bg-(--color-bg-surface) p-12 text-center">
          <p className="font-display text-lg font-light uppercase tracking-wider text-(--color-text-secondary)">
            No templates available.
          </p>
          <p className="mt-2 text-sm text-(--color-text-tertiary)">
            Reinstall the CLI or use <span className="font-mono">contextos template install</span> to add one.
          </p>
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
