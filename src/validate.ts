/**
 * Pure, DOM-free validation and escaping helpers for loaded exports.
 *
 * Kept separate from main.ts (which touches the DOM and runs on import) so the
 * hostile-file surface — schema/shape validation and HTML escaping — can be
 * unit-tested under `node --test` without a browser.
 */

/** Schemas this viewer can render. v3 adds optional token and model usage. */
export const ACCEPTED_SCHEMAS = ['clockwork/v1', 'clockwork/v2', 'clockwork/v3'] as const;

/** Human-readable list for error messages. */
export const ACCEPTED_SCHEMAS_LABEL = `${ACCEPTED_SCHEMAS.slice(0, -1).join(', ')}, or ${ACCEPTED_SCHEMAS.at(-1)}`;

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

const TOKEN_NUMBER_FIELDS = [
  'responses',
  'input',
  'output',
  'cache_read',
  'cache_write',
  'reasoning',
  'total',
] as const;

function tokenUsageError(value: unknown, path: string): string | null {
  if (!isObject(value) || Array.isArray(value)) return `Field "${path}" must be an object.`;
  for (const field of TOKEN_NUMBER_FIELDS) {
    if (typeof value[field] !== 'number') {
      return `Field "${path}.${field}" must be a number.`;
    }
  }
  if (value.by_model !== undefined) {
    if (!Array.isArray(value.by_model)) return `Field "${path}.by_model" must be an array.`;
    for (const model of value.by_model as unknown[]) {
      if (!isObject(model) || Array.isArray(model)) return `A "${path}.by_model" entry is not an object.`;
      if (typeof model.model !== 'string') {
        return `A "${path}.by_model" entry has a non-string "model".`;
      }
      for (const field of TOKEN_NUMBER_FIELDS) {
        if (typeof model[field] !== 'number') {
          return `A "${path}.by_model" entry has a non-number "${field}".`;
        }
      }
    }
  }
  return null;
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
  if (data.tokens !== undefined && typeof data.tokens !== 'boolean')
    return 'Field "tokens" must be a boolean.';
  if (data.providers !== undefined) {
    if (!Array.isArray(data.providers)) return 'Field "providers" must be an array.';
    for (const name of data.providers as unknown[])
      if (typeof name !== 'string') return 'A "providers" entry is not a string.';
  }
  if (data.generated_at !== undefined && typeof data.generated_at !== 'string')
    return 'Field "generated_at" must be a string.';
  if (!Array.isArray(data.projects)) return 'Missing a "projects" array.';
  if (!isObject(data.totals)) return 'Missing a "totals" object.';
  if (data.totals.tokens !== undefined) {
    const error = tokenUsageError(data.totals.tokens, 'totals.tokens');
    if (error) return error;
  }
  if (data.totals.by_provider !== undefined) {
    if (!isObject(data.totals.by_provider)) return 'Field "totals.by_provider" must be an object.';
    for (const [provider, totals] of Object.entries(data.totals.by_provider)) {
      if (!isObject(totals)) return `Field "totals.by_provider.${provider}" must be an object.`;
      if (totals.tokens !== undefined) {
        const error = tokenUsageError(totals.tokens, `totals.by_provider.${provider}.tokens`);
        if (error) return error;
      }
    }
  }

  for (const p of data.projects as unknown[]) {
    if (!isObject(p)) return 'A "projects" entry is not an object.';
    if (typeof p.id !== 'string') return 'A project is missing a string "id".';
    if (typeof p.name !== 'string') return 'A project is missing a string "name".';
    if (p.provider !== undefined && typeof p.provider !== 'string')
      return 'A project\'s "provider" is not a string.';
    if (!isObject(p.totals)) return 'A project is missing its "totals" object.';
    if (p.tokens !== undefined) {
      const error = tokenUsageError(p.tokens, 'projects[].tokens');
      if (error) return error;
    }

    if (p.daily !== undefined) {
      if (!Array.isArray(p.daily)) return 'A project\'s "daily" is not an array.';
      for (const e of p.daily as unknown[]) {
        if (!isObject(e)) return 'A "daily" entry is not an object.';
        if (typeof e.date !== 'string') return 'A "daily" entry has a non-string "date".';
        if (e.tokens !== undefined) {
          const error = tokenUsageError(e.tokens, 'projects[].daily[].tokens');
          if (error) return error;
        }
      }
    }
    if (p.sessions !== undefined && !Array.isArray(p.sessions))
      return 'A project\'s "sessions" is not an array.';
    if (p.prompts !== undefined && !Array.isArray(p.prompts))
      return 'A project\'s "prompts" is not an array.';
  }
  return null;
}
