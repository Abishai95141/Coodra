import { describe, expect, it } from 'vitest';
import { resolveServices, SERVICES } from '../../src/lib/services.js';

describe('SERVICES descriptor', () => {
  it('declares mcp-server + hooks-bridge with their default ports + healthz urls', () => {
    const names = SERVICES.map((s) => s.name);
    expect(names).toEqual(['mcp-server', 'hooks-bridge']);
    const mcp = SERVICES.find((s) => s.name === 'mcp-server');
    expect(mcp?.defaultPort).toBe(3100);
    expect(mcp?.healthUrl(3100)).toBe('http://127.0.0.1:3100/healthz');
    const bridge = SERVICES.find((s) => s.name === 'hooks-bridge');
    expect(bridge?.defaultPort).toBe(3101);
    expect(bridge?.healthUrl(3101)).toBe('http://127.0.0.1:3101/healthz');
  });
});

/**
 * Locks integration finding 2026-04-27 (post-08a walk): the daemon manager
 * was spawning bridge + mcp-server with stderr → /dev/null (launchd default).
 * Doctor check 8 (F15 spot-check) could never green and field debugging was
 * blind. resolveServices now stamps stdoutPath/stderrPath on every DaemonUnit
 * pointing into <contextos-home>/logs/<name>.log.
 */
describe('resolveServices — log routing', () => {
  it('stamps stdoutPath + stderrPath on every DaemonUnit so doctor check 8 has logs to read', async () => {
    const resolved = await resolveServices({
      contextosHome: '/var/test/.contextos',
      env: { MCP_SERVER_PORT: '3100', HOOKS_BRIDGE_PORT: '3101' },
    });
    const mcp = resolved.find((s) => s.descriptor.name === 'mcp-server');
    const bridge = resolved.find((s) => s.descriptor.name === 'hooks-bridge');
    expect(mcp?.unit.stdoutPath).toBe('/var/test/.contextos/logs/mcp-server.log');
    expect(mcp?.unit.stderrPath).toBe('/var/test/.contextos/logs/mcp-server.log');
    expect(bridge?.unit.stdoutPath).toBe('/var/test/.contextos/logs/hooks-bridge.log');
    expect(bridge?.unit.stderrPath).toBe('/var/test/.contextos/logs/hooks-bridge.log');
  });
});
