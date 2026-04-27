import { nodeVersionCheck } from './checks/01-node-version.js';
import { contextosDirCheck } from './checks/02-contextos-dir.js';
import { dataDbOpensCheck } from './checks/03-data-db-opens.js';
import { dbMigrationsHeadCheck } from './checks/04-db-migrations-head.js';
import { globalProjectCheck } from './checks/05-global-project.js';
import { policyKeyShapeCheck } from './checks/06-policy-key-shape.js';
import { runEventsRunIdCheck } from './checks/07-run-events-run-id.js';
import { bridgeRunIdLogsCheck } from './checks/08-bridge-runid-logs.js';
import { mcpStdioCheck } from './checks/09-mcp-stdio.js';
import { mcpHealthzCheck } from './checks/10-mcp-healthz.js';
import { bridgeHealthzCheck } from './checks/11-bridge-healthz.js';
import { projectRegisteredCheck } from './checks/12-project-registered.js';
import { auditDurabilityCheck } from './checks/13-audit-durability.js';
import { mcpConfigValidityCheck } from './checks/14-mcp-config-validity.js';
import { ideDetectionCheck } from './checks/15-ide-detection.js';
import { daemonManagerCheck } from './checks/16-daemon-manager.js';
import { port3100Check } from './checks/17-port-3100.js';
import { port3101Check } from './checks/18-port-3101.js';
import { pnpmPathCheck } from './checks/19-pnpm-path.js';
import { localHookSecretCheck } from './checks/20-local-hook-secret.js';
import type { Check } from './types.js';

export const ALL_CHECKS: readonly Check[] = [
  nodeVersionCheck,
  contextosDirCheck,
  dataDbOpensCheck,
  dbMigrationsHeadCheck,
  globalProjectCheck,
  policyKeyShapeCheck,
  runEventsRunIdCheck,
  bridgeRunIdLogsCheck,
  mcpStdioCheck,
  mcpHealthzCheck,
  bridgeHealthzCheck,
  projectRegisteredCheck,
  auditDurabilityCheck,
  mcpConfigValidityCheck,
  ideDetectionCheck,
  daemonManagerCheck,
  port3100Check,
  port3101Check,
  pnpmPathCheck,
  localHookSecretCheck,
];
