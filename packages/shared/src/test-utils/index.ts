/**
 * `@contextos/shared/test-utils` — assertion helpers + fixtures
 * shared across every ContextOS test suite that needs them. Kept
 * under a dedicated subpath (not re-exported from the package root)
 * so production consumers of `@contextos/shared` do not transitively
 * pick up test-only code in their bundle graph.
 *
 * Subpath contract (see `packages/shared/package.json`):
 *   import { assertManifestDescriptionValid } from '@contextos/shared/test-utils';
 */

export {
  assertManifestDescriptionValid,
  MAX_DESCRIPTION_LENGTH,
  MAX_DESCRIPTION_WORD_COUNT,
  type ManifestDescriptionValidationOptions,
  MIN_DESCRIPTION_LENGTH,
  MIN_DESCRIPTION_WORD_COUNT,
  TOOL_NAME_PATTERN,
} from './manifest-assertions.js';
