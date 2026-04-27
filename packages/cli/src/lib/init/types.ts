/** Per spec §11 Decision 3 — every artifact init touches reports its outcome. */
export type WriteAction = 'wrote' | 'merged' | 'unchanged' | 'forced';

export interface WriteOutcome {
  readonly path: string;
  readonly action: WriteAction;
  readonly notes?: string;
}
