import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemdDaemonManager, type SystemdManagerOptions } from '../../../src/lib/daemon/systemd.js';

type FakeExeca = NonNullable<SystemdManagerOptions['execa']>;

function fakeExeca(
  impl: (file: string, args: readonly string[]) => { exitCode: number; stdout?: string; stderr?: string },
): FakeExeca {
  return vi.fn(async (file: string, args: readonly string[]) => impl(file, args)) as unknown as FakeExeca;
}

describe('SystemdDaemonManager — service-file write + systemctl wiring', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'contextos-daemon-systemd-'));
  });

  afterEach(() => {
    /* tmp cleaned by OS */
  });

  it('isAvailable returns true when systemctl --user --version exits 0', async () => {
    const mgr = new SystemdDaemonManager({
      homeDir: home,
      execa: fakeExeca(() => ({ exitCode: 0, stdout: 'systemd 252' })),
    });
    expect(await mgr.isAvailable()).toBe(true);
  });

  it('install writes ~/.config/systemd/user/contextos-<name>.service + runs daemon-reload', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const mgr = new SystemdDaemonManager({
      homeDir: home,
      execa: fakeExeca((file, args) => {
        calls.push({ file, args: [...args] });
        return { exitCode: 0 };
      }),
    });
    await mgr.install({
      name: 'mcp',
      command: '/usr/bin/node',
      args: ['/opt/contextos/dist/index.js', '--transport', 'stdio'],
      env: { CONTEXTOS_LOG_DESTINATION: 'stderr' },
    });
    const body = await readFile(join(home, '.config/systemd/user/contextos-mcp.service'), 'utf8');
    expect(body).toContain('[Unit]');
    expect(body).toContain('[Service]');
    expect(body).toContain('Type=simple');
    expect(body).toContain('ExecStart=/usr/bin/node');
    expect(body).toContain('Restart=on-failure');
    expect(body).toContain('Environment=CONTEXTOS_LOG_DESTINATION=stderr');
    // daemon-reload should have been called once.
    expect(calls).toEqual([{ file: 'systemctl', args: ['--user', 'daemon-reload'] }]);
  });

  it('start runs systemctl --user start <unit>', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const mgr = new SystemdDaemonManager({
      homeDir: home,
      execa: fakeExeca((file, args) => {
        calls.push({ file, args: [...args] });
        return { exitCode: 0 };
      }),
    });
    await mgr.install({ name: 'svc', command: '/x', args: [], env: {} });
    calls.length = 0; // discard daemon-reload from install
    await mgr.start('svc');
    expect(calls).toEqual([{ file: 'systemctl', args: ['--user', 'start', 'contextos-svc.service'] }]);
  });

  it('status parses ActiveState=active + MainPID', async () => {
    const mgr = new SystemdDaemonManager({
      homeDir: home,
      execa: fakeExeca(() => ({
        exitCode: 0,
        stdout: 'ActiveState=active\nMainPID=9876\n',
      })),
    });
    const status = await mgr.status('svc');
    expect(status.state).toBe('running');
    expect(status.pid).toBe(9876);
  });

  it('status returns stopped when ActiveState=inactive', async () => {
    const mgr = new SystemdDaemonManager({
      homeDir: home,
      execa: fakeExeca(() => ({
        exitCode: 0,
        stdout: 'ActiveState=inactive\nMainPID=0\n',
      })),
    });
    const status = await mgr.status('svc');
    expect(status.state).toBe('stopped');
  });

  it('install renders StandardOutput=append + StandardError=append when paths are set', async () => {
    const mgr = new SystemdDaemonManager({
      homeDir: home,
      execa: fakeExeca(() => ({ exitCode: 0 })),
    });
    await mgr.install({
      name: 'svc-logs',
      command: '/usr/bin/node',
      args: ['/opt/x.js'],
      env: {},
      stdoutPath: '/var/test/.contextos/logs/svc-logs.log',
      stderrPath: '/var/test/.contextos/logs/svc-logs.log',
    });
    const body = await readFile(join(home, '.config/systemd/user/contextos-svc-logs.service'), 'utf8');
    expect(body).toContain('StandardOutput=append:/var/test/.contextos/logs/svc-logs.log');
    expect(body).toContain('StandardError=append:/var/test/.contextos/logs/svc-logs.log');
  });
});
