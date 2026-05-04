import { notFound } from 'next/navigation';
import { resolveProjectFromParams } from '@/lib/project-context';
import { runStateLastModified, serializeRunState } from '@/lib/queries/run-state';
import { getRun } from '@/lib/queries/runs';
import { RunLiveClient } from './RunLiveClient';

/**
 * `/projects/[slug]/runs/[id]/live` — server-rendered initial snapshot,
 * then client-side polling per spec §8 + OQ-2 (M04 Phase 2 S2a IA
 * migration).
 *
 * Server seeds RunLiveClient with the initial snapshot + last-modified
 * timestamp so the first paint is meaningful (no spinner). The client
 * takes over on mount and polls
 * `/api/projects/[slug]/runs/[id]/state` every 1500ms.
 */

export const dynamic = 'force-dynamic';

export default async function RunLivePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const project = await resolveProjectFromParams(params);
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const snapshot = await getRun(id);
  if (snapshot === null) notFound();
  if (snapshot.run.projectId !== project.id) notFound();
  const lastModified = runStateLastModified(snapshot).toUTCString();
  return (
    <RunLiveClient
      runId={id}
      projectSlug={project.slug}
      initialSnapshot={serializeRunState(snapshot)}
      initialLastModified={lastModified}
    />
  );
}
