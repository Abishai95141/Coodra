import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StatusChip } from '@/components/StatusChip';
import { ToolBadge } from '@/components/ToolBadge';
import { addRuleAction, setActiveAction } from '@/lib/actions/policies';
import { resolveProjectFromParams } from '@/lib/project-context';
import { getPolicy } from '@/lib/queries/policies';

/**
 * `/projects/[slug]/policies/[id]` — server-rendered policy detail
 * (M04 Phase 2 S2a IA migration). 404s if the policy doesn't belong
 * to the URL-bound project.
 *
 * Three sections (anchored, not tabbed):
 *   - Rules table (existing rules sorted by priority asc)
 *   - Add Rule form (server action)
 *   - Disable / Enable form (server action; idempotent)
 */

export const dynamic = 'force-dynamic';

interface SearchParams {
  readonly added?: string;
  readonly toggled?: string;
  readonly error?: string;
}

const DECISION_KIND_MAP: Record<string, 'success' | 'warning' | 'error'> = {
  allow: 'success',
  ask: 'warning',
  deny: 'error',
};

export default async function PolicyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const project = await resolveProjectFromParams(params);
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const sp = await searchParams;
  const policy = await getPolicy(id);
  if (policy === null) notFound();
  if (policy.projectId !== project.id) notFound();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="font-mono text-3xl font-medium text-(--color-text-primary)">{policy.name}</h1>
          <StatusChip status={policy.isActive ? 'success' : 'neutral'}>
            {policy.isActive ? 'active' : 'inactive'}
          </StatusChip>
        </div>
        <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <Field label="ID" value={<span className="font-mono">{policy.id}</span>} />
          <Field label="Project" value={<span className="font-mono">{policy.projectId}</span>} />
          {policy.description !== null ? <Field label="Description" value={policy.description} /> : null}
          <Field
            label="Updated"
            value={<span className="font-mono">{policy.updatedAt.toISOString().slice(0, 19).replace('T', ' ')}</span>}
          />
        </dl>
      </header>

      {sp.added !== undefined ? (
        <div className="border-l-4 border-(--color-status-success) bg-(--color-status-success)/10 px-4 py-2 text-sm">
          ✓ Rule added (id <span className="font-mono">{sp.added}</span>). Bridges will see it on the next cache miss (≤
          60s).
        </div>
      ) : null}
      {sp.toggled !== undefined ? (
        <div className="border-l-4 border-(--color-status-info) bg-(--color-status-info)/10 px-4 py-2 text-sm">
          ✓ Policy {sp.toggled}. Bridges apply on next 60s cache miss.
        </div>
      ) : null}
      {sp.error !== undefined ? (
        <div className="border-l-4 border-(--color-status-error) bg-(--color-status-error)/10 px-4 py-2 text-sm">
          ✕ {sp.error}
        </div>
      ) : null}

      <Section title={`Rules (${policy.rules.length})`}>
        {policy.rules.length === 0 ? (
          <Empty hint="No rules on this policy yet. Use the form below to add one." />
        ) : (
          <table className="w-full border border-(--color-border-subtle)">
            <thead className="bg-(--color-bg-elevated)">
              <tr>
                <Th>Pri ↑</Th>
                <Th>Decision</Th>
                <Th>Event</Th>
                <Th>Tool</Th>
                <Th>Path glob</Th>
                <Th>Agent</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {policy.rules.map((rule) => (
                <tr key={rule.id} className="border-b border-(--color-border-subtle)">
                  <td className="px-3 py-2 font-mono text-sm font-medium">{rule.priority}</td>
                  <td className="px-3 py-2">
                    <StatusChip status={DECISION_KIND_MAP[rule.decision] ?? 'neutral'}>{rule.decision}</StatusChip>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-(--color-text-tertiary)">{rule.matchEventType}</td>
                  <td className="px-3 py-2">
                    <ToolBadge name={rule.matchToolName} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-(--color-text-code)">{rule.matchPathGlob ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-(--color-text-tertiary)">
                    {rule.matchAgentType ?? '*'}
                  </td>
                  <td className="px-3 py-2 text-sm text-(--color-text-primary)" title={rule.reason}>
                    {rule.reason.length > 60 ? `${rule.reason.slice(0, 60)}…` : rule.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Add rule">
        <form
          action={addRuleAction}
          className="grid gap-4 border border-(--color-border-subtle) bg-(--color-bg-surface) p-6 md:grid-cols-2"
        >
          <input type="hidden" name="projectId" value={policy.projectId} />
          <input type="hidden" name="policyName" value={policy.name} />
          <input type="hidden" name="returnTo" value={policy.name} />
          <FormField label="Tool name *" name="matchToolName" placeholder="Edit" required />
          <FormField label="Decision *" name="decision" type="select" options={['deny', 'allow', 'ask']} />
          <FormField label="Path glob" name="matchPathGlob" placeholder="**/forbidden/**" />
          <FormField label="Agent type" name="matchAgentType" placeholder="* (any)" />
          <FormField label="Event type" name="matchEventType" type="select" options={['PreToolUse', 'PostToolUse']} />
          <FormField label="Priority" name="priority" placeholder="auto (max + 10)" />
          <FormField
            label="Reason *"
            name="reason"
            type="textarea"
            placeholder="why this rule exists — operator audit context"
            required
            full
          />
          <div className="md:col-span-2">
            <button
              type="submit"
              className="bg-(--color-brand) px-6 py-2 font-display text-xs font-bold uppercase tracking-wider text-white hover:bg-(--color-brand-hover)"
            >
              Add rule
            </button>
          </div>
          <p className="text-xs text-(--color-text-tertiary) md:col-span-2">
            Bridge cache TTL is 60s. New rules visible to running bridges on the next cache miss.
          </p>
        </form>
      </Section>

      <Section title={policy.isActive ? 'Disable policy' : 'Enable policy'}>
        <form action={setActiveAction} className="border border-(--color-border-subtle) bg-(--color-bg-surface) p-6">
          <input type="hidden" name="identifier" value={policy.id} />
          <input type="hidden" name="active" value={policy.isActive ? 'false' : 'true'} />
          <p className="mb-4 text-sm text-(--color-text-secondary)">
            {policy.isActive
              ? `Disabling ${policy.name} stops all ${policy.rules.length} of its rules from applying within ~60s.`
              : `Enabling ${policy.name} resumes all ${policy.rules.length} of its rules within ~60s.`}
          </p>
          <button
            type="submit"
            className={
              policy.isActive
                ? 'bg-(--color-status-error) px-6 py-2 font-display text-xs font-bold uppercase tracking-wider text-white hover:opacity-80'
                : 'bg-(--color-brand) px-6 py-2 font-display text-xs font-bold uppercase tracking-wider text-white hover:bg-(--color-brand-hover)'
            }
          >
            {policy.isActive ? 'Disable' : 'Enable'}
          </button>
        </form>
      </Section>

      <div>
        <Link
          href={`/projects/${encodeURIComponent(project.slug)}/policies` as never}
          className="font-display text-xs font-bold uppercase tracking-wider text-(--color-brand) hover:text-(--color-brand-hover)"
        >
          ◂ Back to policy list
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="font-display text-xs font-bold uppercase tracking-wider text-(--color-text-secondary)">
        {label}:
      </dt>
      <dd className="text-(--color-text-primary)">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-bold uppercase tracking-wide text-(--color-text-primary)">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ hint }: { readonly hint: string }) {
  return (
    <div className="border border-(--color-border-subtle) bg-(--color-bg-surface) p-6 text-center text-sm text-(--color-text-tertiary)">
      {hint}
    </div>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-display text-xs font-bold uppercase tracking-wider text-(--color-text-secondary)">
      {children}
    </th>
  );
}

interface FormFieldProps {
  readonly label: string;
  readonly name: string;
  readonly type?: 'text' | 'select' | 'textarea';
  readonly placeholder?: string;
  readonly options?: readonly string[];
  readonly required?: boolean;
  readonly full?: boolean;
}

function FormField({ label, name, type = 'text', placeholder, options, required, full }: FormFieldProps) {
  const containerClass = `flex flex-col gap-1 ${full === true ? 'md:col-span-2' : ''}`;
  const inputClass =
    'border border-(--color-border-default) bg-(--color-bg-base) px-3 py-2 font-sans text-sm text-(--color-text-primary)';
  const inputId = `field-${name}`;
  return (
    <div className={containerClass}>
      <label
        htmlFor={inputId}
        className="font-display text-xs font-bold uppercase tracking-wider text-(--color-text-secondary)"
      >
        {label}
      </label>
      {type === 'select' && options !== undefined ? (
        <select id={inputId} name={name} required={required} className={inputClass} defaultValue={options[0]}>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          id={inputId}
          name={name}
          required={required}
          placeholder={placeholder}
          rows={3}
          className={inputClass}
        />
      ) : (
        <input
          id={inputId}
          type="text"
          name={name}
          required={required}
          placeholder={placeholder}
          className={inputClass}
        />
      )}
    </div>
  );
}
