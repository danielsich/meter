/**
 * Type definitions for the clockwork `export` command output.
 * Schema: clockwork/v1
 *
 * This dashboard only depends on the fields below. The export may carry
 * additional per-project fields (`path`, `daily`, `sessions`, `prompts`);
 * they are intentionally optional and ignored by the MVP viewer.
 */

export type ClockworkProvider = 'claude' | 'codex' | 'both' | string;

export interface ClockworkProjectTotals {
  minutes: number;
  prompts: number;
  sessions: number;
  active_days: number;
}

export interface ClockworkProject {
  id: string;
  /** Display name — "project-N" when the export was anonymized. */
  name: string;
  totals: ClockworkProjectTotals;
  /** Optional fields present in richer exports; ignored by the MVP. */
  path?: string;
  daily?: unknown;
  sessions?: unknown;
  prompts?: unknown;
}

export interface ClockworkGrandTotals {
  projects: number;
  minutes: number;
  prompts: number;
  sessions: number;
}

export interface ClockworkExport {
  /** Must equal "clockwork/v1"; the viewer refuses to render otherwise. */
  schema: string;
  generated_at: string;
  provider: ClockworkProvider;
  projects: ClockworkProject[];
  totals: ClockworkGrandTotals;
}
