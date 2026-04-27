#!/usr/bin/env node
// MUST be the first import — sets CONTEXTOS_LOG_DESTINATION=stderr before
// any module that constructs a @contextos/shared logger. See
// `lib/log-destination-shim.ts` for the rationale.
import './lib/log-destination-shim.js';
import { buildProgram } from './program.js';

const program = buildProgram();
await program.parseAsync(process.argv);
