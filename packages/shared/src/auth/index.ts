export {
  createAnonymousAuthClient,
  createAuthClient,
  createClerkAuthClient,
  createSoloAuthClient,
  SOLO_IDENTITY,
  verifyClerkJwt,
  verifyLocalHookSecret,
} from './auth.js';
export type { AuthClient, AuthEnv, Identity } from './types.js';
