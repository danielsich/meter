import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const target = join(publicDir, 'clockwork-data.json');

const DAY_MS = 86_400_000;

/** Deterministic 0..1 PRNG so the sample is stable within a given build day. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function dateStrUTC(ord) {
  const d = new Date(ord * DAY_MS);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

const SAMPLE_MODELS = [
  { model: 'claude-sonnet-4-6', share: 0.64, provider: 'claude' },
  { model: 'gpt-5.3-codex', share: 0.23, provider: 'codex' },
  { model: 'claude-opus-4-8', share: 0.13, provider: 'claude' },
];

function sumTokenUsage(usages) {
  const byModel = new Map();
  const total = {
    responses: 0, input: 0, output: 0, cache_read: 0,
    cache_write: 0, reasoning: 0, total: 0,
  };
  for (const usage of usages) {
    for (const field of ['responses', 'input', 'output', 'cache_read', 'cache_write', 'reasoning']) {
      total[field] += usage[field];
    }
    for (const model of usage.by_model) {
      const current = byModel.get(model.model) ?? {
        model: model.model,
        responses: 0, input: 0, output: 0, cache_read: 0,
        cache_write: 0, reasoning: 0, total: 0,
      };
      for (const field of ['responses', 'input', 'output', 'cache_read', 'cache_write', 'reasoning']) {
        current[field] += model[field];
      }
      current.total = current.input + current.output + current.cache_read + current.cache_write;
      byModel.set(model.model, current);
    }
  }
  total.total = total.input + total.output + total.cache_read + total.cache_write;
  return {
    ...total,
    by_model: [...byModel.values()].sort((a, b) => b.total - a.total),
  };
}

/** Plausible daily model mix; cache dominates without flattening the UI. */
function sampleTokens(promptCount, rng) {
  const responses = Math.max(1, Math.round(promptCount * (1.15 + rng() * 0.75)));
  let remaining = responses;
  const by_model = SAMPLE_MODELS.flatMap((spec, index) => {
    const count = index === SAMPLE_MODELS.length - 1
      ? remaining
      : Math.min(remaining, Math.max(index === 0 ? 1 : 0, Math.round(responses * spec.share)));
    remaining -= count;
    if (count === 0) return [];
    const input = Math.round(count * (95 + rng() * 90));
    const output = Math.round(count * (620 + rng() * 880));
    const cache_read = Math.round(count * (36_000 + rng() * 34_000));
    const cache_write = spec.provider === 'claude'
      ? Math.round(count * (750 + rng() * 1_650))
      : 0;
    const reasoning = spec.provider === 'codex'
      ? Math.round(output * (0.25 + rng() * 0.2))
      : 0;
    return [{
      model: spec.model,
      responses: count,
      input,
      output,
      cache_read,
      cache_write,
      reasoning,
      total: input + output + cache_read + cache_write,
    }];
  }).sort((a, b) => b.total - a.total);
  return sumTokenUsage(by_model.map((model) => ({ ...model, by_model: [model] })));
}

/** Build one sample project ending on `todayOrd`, with a live tail streak. */
function sampleProject(id, name, todayOrd, { span, minsBase, seed, tail }) {
  const rng = makeRng(seed);
  const daily = [];
  const sessions = [];
  const prompts = [];

  for (let k = span; k >= 0; k--) {
    const ord = todayOrd - k;
    const inTail = k < tail;
    if (!inTail && (k % 5 === 0 || rng() < 0.35)) continue; // scattered gaps

    const minutes = Math.round(minsBase * (0.5 + rng() * 1.4));
    const promptCount = Math.max(1, Math.round(minutes / (6 + rng() * 8)));
    const tokens = sampleTokens(promptCount, rng);
    daily.push({ date: dateStrUTC(ord), minutes, prompts: promptCount, tokens });

    const dayStartSec = ord * 86400;
    const startHour = 8 + Math.floor(rng() * 3);
    sessions.push({
      start: dayStartSec + startHour * 3600,
      end: dayStartSec + startHour * 3600 + minutes * 60,
      minutes,
      prompts: promptCount,
    });
    for (let i = 0; i < promptCount; i++) {
      prompts.push(Math.floor(dayStartSec + (startHour + rng() * 9) * 3600));
    }
  }

  prompts.sort((a, b) => a - b);
  sessions.sort((a, b) => a.start - b.start);
  const minutes = daily.reduce((sum, d) => sum + d.minutes, 0);
  const promptTotal = daily.reduce((sum, d) => sum + d.prompts, 0);
  const tokens = sumTokenUsage(daily.map((day) => day.tokens));

  return {
    id,
    name,
    provider: 'sample',
    path: `/anon/${name}`,
    first: sessions[0].start,
    last: sessions[sessions.length - 1].end,
    totals: {
      minutes,
      prompts: promptTotal,
      sessions: sessions.length,
      active_days: daily.length,
    },
    tokens,
    daily,
    sessions,
    prompts,
  };
}

/**
 * A shape-valid, feature-complete clockwork/v3 export, generated relative to
 * the build date so streaks and the 12-week calendar always look current.
 * `provider: "sample"` keeps meter's "you're viewing sample data" state on.
 *
 * This is the ONLY data the deployed site ever ships. meter is a public career
 * showcase, so production data is synthetic by design — there is deliberately no
 * path to bundle a real clockwork export into the build. Visitors can still load
 * their own export in the browser (File API), which never leaves their device.
 */
function buildSample() {
  const now = new Date();
  const todayOrd = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / DAY_MS,
  );

  const projects = [
    sampleProject('sample-1', 'project-1', todayOrd, {
      span: 74,
      minsBase: 150,
      seed: 11,
      tail: 9,
    }),
    sampleProject('sample-2', 'project-2', todayOrd, {
      span: 66,
      minsBase: 95,
      seed: 29,
      tail: 5,
    }),
    sampleProject('sample-3', 'project-3', todayOrd, {
      span: 52,
      minsBase: 60,
      seed: 47,
      tail: 3,
    }),
  ];
  const tokens = sumTokenUsage(projects.map((project) => project.tokens));
  const providerTotals = {
    projects: projects.length,
    minutes: projects.reduce((s, p) => s + p.totals.minutes, 0),
    prompts: projects.reduce((s, p) => s + p.totals.prompts, 0),
    sessions: projects.reduce((s, p) => s + p.totals.sessions, 0),
    tokens,
  };

  return {
    schema: 'clockwork/v3',
    generated_at: now.toISOString(),
    provider: 'sample',
    providers: ['sample'],
    tokens: true,
    daily_tz: 'UTC',
    projects,
    totals: { ...providerTotals, by_provider: { sample: providerTotals } },
  };
}

async function main() {
  await mkdir(publicDir, { recursive: true });
  await writeFile(target, `${JSON.stringify(buildSample(), null, 2)}\n`, 'utf8');
  console.log('[prepare-data] Wrote generated sample data to public/clockwork-data.json');
}

main().catch((err) => {
  console.error('[prepare-data] Failed:', err);
  process.exit(1);
});
