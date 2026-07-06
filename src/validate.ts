/**
 * Pure, DOM-free validation and escaping helpers for loaded exports.
 *
 * Kept separate from main.ts (which touches the DOM and runs on import) so the
 * hostile-file surface — schema/shape validation and HTML escaping — can be
 * unit-tested under `node --test` without a browser.
 */

/** Schemas this viewer can render. v2 adds per-project `provider` + `providers[]`. */
export const ACCEPTED_SCHEMAS = ['clockwork/v1', 'clockwork/v2'] as const;

/** Human-readable list for error messages, e.g. "clockwork/v1 or clockwork/v2". */
export const ACCEPTED_SCHEMAS_LABEL = ACCEPTED_SCHEMAS.join(' or ');

export function isSchemaSupported(schema: unknown): boolean {
  return typeof schema === 'string' && (ACCEPTED_SCHEMAS as readonly string[]).includes(schema);
}

/**
 * Upper bound for a loaded export. A real clockwork/v1 file is well under this
 * even at --detail raw; the cap stops a hostile or accidental multi-hundred-MB
 * file from freezing the tab during parse/render.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function escapeHtml(value: unknown): string {
  // Coerce first: a non-string field (number, or an attacker-supplied object)
  // would otherwise throw on .replace and skip escaping entirely.
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Strict structural guard for parsed exports. Rejects the wrong shape *and* the
 * wrong types for the fields the renderers inject into HTML (project id/name,
 * daily date) or iterate as arrays, so a malformed or hostile file fails with a
 * readable message instead of a stack trace or an injection. Field-level
 * escaping/coercion at render time is the second line of defense.
 *
 * It intentionally does not require optional detail fields to be present — a
 * summary-only export is valid — only that, when present, they have the right
 * type.
 */
export function structuralError(data: unknown): string | null {
  if (!isObject(data)) return 'Expected a JSON object at the top level.';

  if (data.provider !== undefined && typeof data.provider !== 'string')
    return 'Field "provider" must be a string.';
  if (data.providers !== undefined) {
    if (!Array.isArray(data.providers)) return 'Field "providers" must be an array.';
    for (const name of data.providers as unknown[])
      if (typeof name !== 'string') return 'A "providers" entry is not a string.';
  }
  if (data.generated_at !== undefined && typeof data.generated_at !== 'string')
    return 'Field "generated_at" must be a string.';
  if (!Array.isArray(data.projects)) return 'Missing a "projects" array.';
  if (!isObject(data.totals)) return 'Missing a "totals" object.';

  for (const p of data.projects as unknown[]) {
    if (!isObject(p)) return 'A "projects" entry is not an object.';
    if (typeof p.id !== 'string') return 'A project is missing a string "id".';
    if (typeof p.name !== 'string') return 'A project is missing a string "name".';
    if (p.provider !== undefined && typeof p.provider !== 'string')
      return 'A project\'s "provider" is not a string.';
    if (!isObject(p.totals)) return 'A project is missing its "totals" object.';

    if (p.daily !== undefined) {
      if (!Array.isArray(p.daily)) return 'A project\'s "daily" is not an array.';
      for (const e of p.daily as unknown[]) {
        if (!isObject(e)) return 'A "daily" entry is not an object.';
        if (typeof e.date !== 'string') return 'A "daily" entry has a non-string "date".';
      }
    }
    if (p.sessions !== undefined && !Array.isArray(p.sessions))
      return 'A project\'s "sessions" is not an array.';
    if (p.prompts !== undefined && !Array.isArray(p.prompts))
      return 'A project\'s "prompts" is not an array.';
  }
  return null;
}
