/**
 * Type definitions for the clockwork `export` command output.
 * Schema: clockwork/v1
 *
 * Which per-project fields are present depends on the export `--detail` level:
 *   summary  → totals only
 *   daily    → + daily[]
 *   sessions → + daily[], sessions[]
 *   raw      → + daily[], sessions[], prompts[]
 *
 * Every consumer must treat the optional fields as possibly-absent.
 */

export type ClockworkProvider = 'claude' | 'codex' | 'both' | string;

export interface ClockworkProjectTotals {
  minutes: number;
  prompts: number;
  sessions: number;
  active_days: number;
  /** Epoch seconds — present in clockwork/v1 exports with --detail daily or richer. */
  first?: number;
  last?: number;
}

/** One calendar day of activity (date is YYYY-MM-DD in `daily_tz`, i.e. UTC). */
export interface DailyEntry {
  date: string;
  minutes: number;
  prompts: number;
}

/** One work session. `start`/`end` are epoch seconds. */
export interface SessionEntry {
  start: number;
  end: number;
  minutes: number;
  prompts: number;
}

export interface ClockworkProject {
  id: string;
  /** Display name — "project-N" when the export was anonymized. */
  name: string;
  totals: ClockworkProjectTotals;
  path?: string;
  /** @deprecated first/last moved to totals in clockwork/v1. Kept for older exports. */
  first?: number;
  /** @deprecated first/last moved to totals in clockwork/v1. Kept for older exports. */
  last?: number;
  /** Present at --detail daily and richer. */
  daily?: DailyEntry[];
  /** Present at --detail sessions and richer. */
  sessions?: SessionEntry[];
  /** Prompt timestamps (epoch seconds); present only at --detail raw. */
  prompts?: number[];
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
  /** Timezone the `daily[].date` strings are bucketed in; "UTC" in v1. */
  daily_tz?: string;
  /** Export detail level: "raw" | "sessions" | "daily". */
  detail?: string;
  anonymized?: boolean;
  idle_threshold_min?: number;
  /** ISO bound if --since was given, else null. */
  since?: string | null;
  until?: string | null;
  projects: ClockworkProject[];
  totals: ClockworkGrandTotals;
}
