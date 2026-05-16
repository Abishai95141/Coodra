export {
  createAnonymousAuthClient,
  createAuthClient,
  createClerkAuthClient,
  createSoloAuthClient,
  SOLO_IDENTITY,
  verifyClerkJwt,
  verifyLocalHookSecret,
} from './auth.js';
export {
  deleteToken,
  getClerkTokenPath,
  hasStoredToken,
  loadHomeEnvForVerify,
  readVerifiedToken,
  type StoredToken,
  type TokenStoreOptions,
  writeToken,
} from './clerk-token-store.js';
export {
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
} from './roles.js';
export type { AuthClient, AuthEnv, Identity } from './types.js';
export {
  clearVerifyClerkJwtCache,
  type VerifiedClerkClaims,
  verifyClerkJwtAndExtractClaims,
} from './verify-clerk-jwt.js';
