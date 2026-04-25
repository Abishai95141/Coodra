import { describe, expect, it } from 'vitest';

import { AGENT_TYPE_MAPPING, type KnownAgentType, mapAgentType } from '../../../src/lib/agent-type.js';

/**
 * Unit tests for `src/lib/agent-type.ts`.
 *
 * Locks the mapping table and the `mapAgentType` resolution contract
 * — every entry in `AGENT_TYPE_MAPPING` has a round-trip test so an
 * accidental deletion fails CI. Deliberately separate from the tool
 * tests so adding new agent clients doesn't churn tool-level tests.
 */

describe('mapAgentType', () => {
  it('returns "unknown" for undefined / null / non-string / empty input', () => {
    expect(mapAgentType(undefined)).toBe<KnownAgentType>('unknown');
    expect(mapAgentType(null)).toBe<KnownAgentType>('unknown');
    expect(mapAgentType(123)).toBe<KnownAgentType>('unknown');
    expect(mapAgentType('')).toBe<KnownAgentType>('unknown');
  });

  it('returns "unknown" for an unmapped client name', () => {
    expect(mapAgentType('totally-new-agent-nobody-has-seen')).toBe<KnownAgentType>('unknown');
  });

  it('maps Claude Code handshake names to claude_code', () => {
    expect(mapAgentType('claude-code')).toBe<KnownAgentType>('claude_code');
    expect(mapAgentType('claude-ai')).toBe<KnownAgentType>('claude_code');
  });

  it('maps Cursor handshake names to cursor', () => {
    expect(mapAgentType('cursor')).toBe<KnownAgentType>('cursor');
    expect(mapAgentType('cursor-vscode')).toBe<KnownAgentType>('cursor');
  });

  it('maps Windsurf to windsurf', () => {
    expect(mapAgentType('windsurf')).toBe<KnownAgentType>('windsurf');
  });

  it('maps VS Code Copilot Chat to vscode_copilot', () => {
    expect(mapAgentType('github-copilot-chat-vscode')).toBe<KnownAgentType>('vscode_copilot');
  });

  it('maps MCP Inspector to mcp_inspector', () => {
    expect(mapAgentType('mcp-inspector')).toBe<KnownAgentType>('mcp_inspector');
  });

  it('is case-insensitive', () => {
    expect(mapAgentType('CLAUDE-CODE')).toBe<KnownAgentType>('claude_code');
    expect(mapAgentType('Cursor')).toBe<KnownAgentType>('cursor');
    expect(mapAgentType('Windsurf')).toBe<KnownAgentType>('windsurf');
  });
});

describe('AGENT_TYPE_MAPPING table — lock against accidental entry removal', () => {
  it.each(Object.entries(AGENT_TYPE_MAPPING))('maps "%s" → "%s"', (clientName, expectedAgentType) => {
    expect(mapAgentType(clientName)).toBe(expectedAgentType);
  });

  it('is frozen so runtime mutation cannot change the mapping', () => {
    expect(Object.isFrozen(AGENT_TYPE_MAPPING)).toBe(true);
  });
});
