import { isLogService, logPathFor, watchTail } from '@/lib/log-tail';

/**
 * `/api/projects/[slug]/logs/[service]/stream` — Server-Sent Events
 * (SSE) endpoint for the M04 Phase 2 S11 logs surface.
 *
 * The client opens an EventSource against this URL. We pipe new log
 * lines as `data:` events; the browser auto-reconnects on network
 * blips per the SSE spec.
 *
 * Query params:
 *   - fromOffset (number) — byte offset to start tailing from. The
 *     page boots with the offset returned by `readLastLines`, so the
 *     first tail event is precisely the next line after the last one
 *     rendered server-side. Without it we tail from EOF.
 *
 * Heartbeat: a comment line every 25s prevents proxies from killing
 * the idle connection.
 *
 * Project slug is accepted in the path for navigation symmetry but
 * the log files are workspace-grain (per-service, not per-project).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; service: string }> },
): Promise<Response> {
  const { service } = await params;
  if (!isLogService(service)) {
    return new Response(`unknown service: ${service}`, { status: 404 });
  }
  const path = logPathFor(service);
  const url = new URL(request.url);
  const offsetParam = url.searchParams.get('fromOffset');
  const fromOffset = offsetParam !== null && /^\d+$/.test(offsetParam) ? Number.parseInt(offsetParam, 10) : 0;

  const encoder = new TextEncoder();
  let teardown: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // Stream already closed by the consumer.
        }
      };
      // Initial hello so the client knows the channel is alive.
      send('hello', JSON.stringify({ service, fromOffset }));

      teardown = watchTail({
        path,
        fromOffset,
        onLines: (lines, newOffset) => {
          send('lines', JSON.stringify({ lines, offset: newOffset }));
        },
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          // Closed.
        }
      }, 25_000);

      const onAbort = () => {
        if (teardown !== null) teardown();
        if (heartbeat !== null) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      request.signal.addEventListener('abort', onAbort);
    },
    cancel() {
      if (teardown !== null) teardown();
      if (heartbeat !== null) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
