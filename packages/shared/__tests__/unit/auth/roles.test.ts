import { describe, expect, it } from 'vitest';
import {
  type Actor,
  assertCanAuthorKnowledge,
  assertCanEdit,
  assertCanEditKnowledge,
  assertCanResumeKillSwitch,
  hasRole,
  parseClerkRole,
  ROLES,
  type Role,
  requireRole,
  SOLO_ACTOR,
} from '../../../src/auth/roles.js';
import { ForbiddenError } from '../../../src/errors/index.js';

/**
 * Module 04 Phase 4 — Tier 2.5 RBAC. Tests cover:
 *   1. parseClerkRole maps Clerk strings → internal Role.
 *   2. hasRole / requireRole respect the rank ordering viewer<member<admin.
 *   3. assertCanEdit allows admin always; allowOwner gates non-admin edits.
 *   4. Solo actor short-circuits to admin.
 *   5. assertCanResumeKillSwitch — admins always; member if pausedByUserId matches.
 */

function actor(role: Role, userId = 'user_42'): Actor {
  return { userId, orgId: 'org_acme', role, source: 'clerk' };
}

describe('ROLES + ranking invariants', () => {
  it('exposes exactly three roles in ascending privilege order', () => {
    expect(ROLES).toEqual(['viewer', 'member', 'admin']);
  });
});

describe('parseClerkRole', () => {
  it('maps org:admin to admin', () => {
    expect(parseClerkRole('org:admin')).toBe('admin');
  });

  it('maps org:viewer to viewer (custom Clerk role)', () => {
    expect(parseClerkRole('org:viewer')).toBe('viewer');
  });

  it('maps org:basic_member to member', () => {
    expect(parseClerkRole('org:basic_member')).toBe('member');
  });

  it('defaults unknown role to member (safe floor for session use)', () => {
    expect(parseClerkRole('org:invented_role')).toBe('member');
  });

  it('defaults null and undefined to member', () => {
    expect(parseClerkRole(null)).toBe('member');
    expect(parseClerkRole(undefined)).toBe('member');
  });

  it('is case-insensitive on the role suffix', () => {
    expect(parseClerkRole('org:ADMIN')).toBe('admin');
    expect(parseClerkRole('Org:Viewer')).toBe('viewer');
  });

  it('strips the org: prefix permissively', () => {
    expect(parseClerkRole('admin')).toBe('admin');
    expect(parseClerkRole('viewer')).toBe('viewer');
  });
});

describe('hasRole + requireRole', () => {
  it('admin satisfies every minimum', () => {
    expect(hasRole(actor('admin'), 'admin')).toBe(true);
    expect(hasRole(actor('admin'), 'member')).toBe(true);
    expect(hasRole(actor('admin'), 'viewer')).toBe(true);
  });

  it('member does not satisfy admin', () => {
    expect(hasRole(actor('member'), 'admin')).toBe(false);
    expect(hasRole(actor('member'), 'member')).toBe(true);
    expect(hasRole(actor('member'), 'viewer')).toBe(true);
  });

  it('viewer satisfies only viewer', () => {
    expect(hasRole(actor('viewer'), 'admin')).toBe(false);
    expect(hasRole(actor('viewer'), 'member')).toBe(false);
    expect(hasRole(actor('viewer'), 'viewer')).toBe(true);
  });

  it("requireRole throws ForbiddenError when actor's role is below min", () => {
    expect(() => requireRole(actor('member'), 'admin')).toThrow(ForbiddenError);
    expect(() => requireRole(actor('viewer'), 'member')).toThrow(ForbiddenError);
  });

  it('requireRole returns silently when role is sufficient', () => {
    expect(() => requireRole(actor('admin'), 'admin')).not.toThrow();
    expect(() => requireRole(actor('member'), 'member')).not.toThrow();
  });
});

describe('assertCanEdit', () => {
  it('admin can edit anything', () => {
    expect(() => assertCanEdit(actor('admin'), { createdByUserId: 'someone-else' })).not.toThrow();
    expect(() => assertCanEdit(actor('admin'), { createdByUserId: null })).not.toThrow();
  });

  it('member cannot edit by default (allowOwner false)', () => {
    expect(() => assertCanEdit(actor('member'), { createdByUserId: 'user_42' })).toThrow(ForbiddenError);
  });

  it('member can edit own resource when allowOwner=true', () => {
    expect(() =>
      assertCanEdit(actor('member', 'user_42'), { createdByUserId: 'user_42' }, { allowOwner: true }),
    ).not.toThrow();
  });

  it("member cannot edit someone else's resource even with allowOwner=true", () => {
    expect(() =>
      assertCanEdit(actor('member', 'user_42'), { createdByUserId: 'user_99' }, { allowOwner: true }),
    ).toThrow(ForbiddenError);
  });

  it('null createdByUserId is never owned (admin-only edit)', () => {
    expect(() => assertCanEdit(actor('member'), { createdByUserId: null }, { allowOwner: true })).toThrow(
      ForbiddenError,
    );
  });

  it('viewer cannot edit even own resources (read-only)', () => {
    expect(() =>
      assertCanEdit(actor('viewer', 'user_42'), { createdByUserId: 'user_42' }, { allowOwner: true }),
    ).toThrow(ForbiddenError);
  });
});

describe('assertCanResumeKillSwitch', () => {
  it('admin can resume any kill switch', () => {
    expect(() => assertCanResumeKillSwitch(actor('admin'), { pausedByUserId: 'someone-else' })).not.toThrow();
  });

  it('member can resume own pause', () => {
    expect(() => assertCanResumeKillSwitch(actor('member', 'user_42'), { pausedByUserId: 'user_42' })).not.toThrow();
  });

  it('member cannot resume admin-initiated pause', () => {
    expect(() => assertCanResumeKillSwitch(actor('member', 'user_42'), { pausedByUserId: 'user_admin' })).toThrow(
      ForbiddenError,
    );
  });

  it('member cannot resume CLI-initiated pause (pausedByUserId null)', () => {
    expect(() => assertCanResumeKillSwitch(actor('member', 'user_42'), { pausedByUserId: null })).toThrow(
      ForbiddenError,
    );
  });

  it('viewer cannot resume even own pauses', () => {
    expect(() => assertCanResumeKillSwitch(actor('viewer', 'user_42'), { pausedByUserId: 'user_42' })).toThrow(
      ForbiddenError,
    );
  });
});

describe('assertCanAuthorKnowledge (Phase F.3)', () => {
  it('admin can author features / feature packs', () => {
    expect(() => assertCanAuthorKnowledge(actor('admin'))).not.toThrow();
  });

  it('member can author features / feature packs', () => {
    expect(() => assertCanAuthorKnowledge(actor('member'))).not.toThrow();
  });

  it('viewer cannot author (knowledge layer is gated above the read-only floor)', () => {
    expect(() => assertCanAuthorKnowledge(actor('viewer'))).toThrow(ForbiddenError);
  });

  it('SOLO_ACTOR always passes (admin)', () => {
    expect(() => assertCanAuthorKnowledge(SOLO_ACTOR)).not.toThrow();
  });
});

describe('assertCanEditKnowledge (Phase F.3)', () => {
  it("admin can edit anyone's knowledge artifact", () => {
    expect(() => assertCanEditKnowledge(actor('admin'), { createdByUserId: 'someone-else' })).not.toThrow();
  });

  it('member can edit own knowledge artifact (default allowOwner=true)', () => {
    expect(() => assertCanEditKnowledge(actor('member', 'user_42'), { createdByUserId: 'user_42' })).not.toThrow();
  });

  it("member cannot edit another member's knowledge artifact", () => {
    expect(() => assertCanEditKnowledge(actor('member', 'user_42'), { createdByUserId: 'user_99' })).toThrow(
      ForbiddenError,
    );
  });

  it('viewer cannot edit even own knowledge artifacts (read-only role)', () => {
    expect(() => assertCanEditKnowledge(actor('viewer', 'user_42'), { createdByUserId: 'user_42' })).toThrow(
      ForbiddenError,
    );
  });

  it('allowOwner=false locks member out of own-resource edits (admin-only)', () => {
    expect(() =>
      assertCanEditKnowledge(actor('member', 'user_42'), { createdByUserId: 'user_42' }, { allowOwner: false }),
    ).toThrow(ForbiddenError);
  });

  it('null createdByUserId is admin-only even with allowOwner=true', () => {
    expect(() => assertCanEditKnowledge(actor('member'), { createdByUserId: null }, { allowOwner: true })).toThrow(
      ForbiddenError,
    );
  });
});

describe('SOLO_ACTOR', () => {
  it('is admin role with __solo__ ids', () => {
    expect(SOLO_ACTOR.userId).toBe('__solo__');
    expect(SOLO_ACTOR.orgId).toBe('__solo__');
    expect(SOLO_ACTOR.role).toBe('admin');
    expect(SOLO_ACTOR.source).toBe('solo-bypass');
  });

  it('is frozen — cannot be mutated', () => {
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing freeze behaviour
      (SOLO_ACTOR as any).role = 'viewer';
    }).toThrow();
  });

  it('passes every requireRole check', () => {
    expect(() => requireRole(SOLO_ACTOR, 'admin')).not.toThrow();
    expect(() => requireRole(SOLO_ACTOR, 'member')).not.toThrow();
    expect(() => requireRole(SOLO_ACTOR, 'viewer')).not.toThrow();
  });
});
