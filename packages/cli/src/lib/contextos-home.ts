import { homedir } from 'node:os';
import { join } from 'node:path';
import envPaths from 'env-paths';

/**
 * Resolves the `~/.contextos/` location per spec §11 Decision 2:
 *   - Linux + `$XDG_CONFIG_HOME` set → `$XDG_CONFIG_HOME/contextos/`
 *   - Linux without XDG → `$HOME/.contextos/`
 *   - macOS / Windows → `$HOME/.contextos/` (no XDG, no `%APPDATA%` translation)
 *
 * `env-paths` handles the XDG branch on Linux when `$XDG_CONFIG_HOME` is set.
 * On macOS and Windows it returns platform-specific paths we explicitly do
 * not want (e.g. `~/Library/Preferences/contextos-nodejs/Config` on macOS),
 * so we override with `$HOME/.contextos/` for non-Linux platforms.
 *
 * Override hooks (in order of precedence):
 *   1. `options.override` argument — for tests + the contributor dev-loop
 *      pattern documented in `docs/DEVELOPMENT.md`.
 *   2. `CONTEXTOS_HOME` env var — for ad-hoc shell overrides.
 *   3. Decision 2 default per platform.
 */
export interface ResolveContextosHomeOptions {
  readonly override?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
}

export function resolveContextosHome(options: ResolveContextosHomeOptions = {}): string {
  if (options.override !== undefined && options.override.length > 0) {
    return options.override;
  }
  const env = options.env ?? process.env;
  const overrideEnv = env.CONTEXTOS_HOME;
  if (typeof overrideEnv === 'string' && overrideEnv.length > 0) {
    return overrideEnv;
  }
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();

  if (platform === 'linux') {
    // Use env-paths to honour $XDG_CONFIG_HOME when set; the `{ suffix: '' }`
    // configuration drops the default `-nodejs` suffix so the directory is
    // exactly `contextos/`.
    const xdg = env.XDG_CONFIG_HOME;
    if (typeof xdg === 'string' && xdg.length > 0) {
      // env-paths reads $XDG_CONFIG_HOME from process.env, so call it inline
      // when set to keep the spec semantics. Suffix '' drops `-nodejs`.
      const paths = envPaths('contextos', { suffix: '' });
      return paths.config;
    }
    return join(home, '.contextos');
  }

  // macOS, Windows, *BSD, others — `$HOME/.contextos/` per Decision 2.
  return join(home, '.contextos');
}

export function resolveContextosDataDb(homePath: string): string {
  return join(homePath, 'data.db');
}

export function resolveContextosLogsDir(homePath: string): string {
  return join(homePath, 'logs');
}

export function resolveContextosPidsDir(homePath: string): string {
  return join(homePath, 'pids');
}

export function resolveContextosConfigJson(homePath: string): string {
  return join(homePath, 'config.json');
}
