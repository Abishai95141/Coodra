import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FallbackDaemonManager } from '../../../src/lib/daemon/fallback.js';

describe('FallbackDaemonManager — real-spawn integration', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'contextos-daemon-fallback-'));
    await mkdir(join(home, 'pids'), { recursive: true });
  });

  afterEach(() => {
    /* tmp cleaned by OS */
  });

  it('install + start + status + stop lifecycle against `node -e "setInterval(...)"`', async () => {
    const mgr = new FallbackDaemonManager({ contextosHome: home });

    expect(await mgr.isAvailable()).toBe(true);

    // Install a long-running noop daemon.
    await mgr.install({
      name: 'test-daemon',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 60_000)'],
      env: {},
    });

    // Check the unit file landed.
    const unitPath = join(home, 'pids', 'test-daemon.unit.json');
    const record = JSON.parse(await readFile(unitPath, 'utf8'));
    expect(record.name).toBe('test-daemon');
    expect(record.command).toBe(process.execPath);

    // Start it.
    await mgr.start('test-daemon');
    let status = await mgr.status('test-daemon');
    expect(status.state).toBe('running');
    expect(status.pid).toBeGreaterThan(0);

    // List should include it.
    const list = await mgr.list();
    expect(list.find((s) => s.name === 'test-daemon')?.state).toBe('running');

    // Stop is idempotent: first call kills, second call no-ops.
    await mgr.stop('test-daemon');
    await mgr.stop('test-daemon');
    status = await mgr.status('test-daemon');
    expect(status.state).toBe('stopped');

    // Uninstall removes both files.
    await mgr.uninstall('test-daemon');
    await expect(readFile(unitPath, 'utf8')).rejects.toThrow();
  });

  it('start is idempotent — second call no-ops when already running', async () => {
    const mgr = new FallbackDaemonManager({ contextosHome: home });
    await mgr.install({
      name: 'idempo',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 60_000)'],
      env: {},
    });
    await mgr.start('idempo');
    const first = await mgr.status('idempo');
    await mgr.start('idempo');
    const second = await mgr.status('idempo');
    expect(second.pid).toBe(first.pid);
    await mgr.stop('idempo');
    await mgr.uninstall('idempo');
  });

  it('status returns stopped when no PID file exists', async () => {
    const mgr = new FallbackDaemonManager({ contextosHome: home });
    expect((await mgr.status('never-installed')).state).toBe('stopped');
  });

  it('start throws when no unit was installed', async () => {
    const mgr = new FallbackDaemonManager({ contextosHome: home });
    await expect(mgr.start('not-here')).rejects.toThrow(/no unit installed/);
  });
});
