import { access, constants, stat } from 'node:fs/promises';
import type { Check } from '../types.js';

export const contextosDirCheck: Check = {
  id: 2,
  name: '~/.contextos/ exists, writable, mode 0700',
  severity: 'red',
  async run(ctx) {
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(ctx.contextosHome);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return {
          status: 'red',
          detail: `${ctx.contextosHome} does not exist`,
          remediation: 'Run `contextos init` to create the ContextOS home directory.',
        };
      }
      return {
        status: 'red',
        detail: `stat ${ctx.contextosHome}: ${(err as Error).message}`,
        remediation: 'Check filesystem permissions on the parent directory.',
      };
    }

    if (!st.isDirectory()) {
      return {
        status: 'red',
        detail: `${ctx.contextosHome} exists but is not a directory`,
        remediation: 'Move or rename the file at that path, then run `contextos init`.',
      };
    }

    try {
      await access(ctx.contextosHome, constants.W_OK);
    } catch {
      return {
        status: 'red',
        detail: `${ctx.contextosHome} is not writable`,
        remediation: `\`chmod 0700 ${ctx.contextosHome}\` and ensure the current user owns it.`,
      };
    }

    if (ctx.platform !== 'win32') {
      // POSIX mode bits — Windows lacks meaningful POSIX permissions.
      const mode = st.mode & 0o777;
      if (mode !== 0o700) {
        return {
          status: 'yellow',
          detail: `mode is 0${mode.toString(8)}, expected 0700`,
          remediation: `\`chmod 0700 ${ctx.contextosHome}\` to lock down permissions.`,
        };
      }
    }
    return { status: 'green', detail: `${ctx.contextosHome} ready` };
  },
};
