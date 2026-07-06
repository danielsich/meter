import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'data', 'clockwork-data.json');
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
    daily.push({ date: dateStrUTC(ord), minutes, prompts: promptCount });

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

  return {
    id,
    name,
    path: `/anon/${name}`,
    first: sessions[0].start,
    last: sessions[sessions.length - 1].end,
    totals: {
      minutes,
      prompts: promptTotal,
      sessions: sessions.length,
      active_days: daily.length,
    },
    daily,
    sessions,
    prompts,
  };
}

/**
 * A shape-valid, feature-complete clockwork/v1 export, generated relative to
 * the build date so streaks and the 12-week calendar always look current.
 * `provider: "sample"` keeps meter's "you're viewing sample data" state on.
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

  return {
    schema: 'clockwork/v1',
    generated_at: now.toISOString(),
    provider: 'sample',
    daily_tz: 'UTC',
    projects,
    totals: {
      projects: projects.length,
      minutes: projects.reduce((s, p) => s + p.totals.minutes, 0),
      prompts: projects.reduce((s, p) => s + p.totals.prompts, 0),
      sessions: projects.reduce((s, p) => s + p.totals.sessions, 0),
    },
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guard against publishing non-anonymized data to the public site. Enforced in
 * CI (and any GitHub Actions run); locally it only warns, so you can preview a
 * real export. Set METER_ALLOW_UNANONYMIZED=1 to deploy real data on purpose
 * (e.g. a private repo). This cannot scrub data already committed to git.
 */
function assertAnonymized(raw) {
  if (process.env.METER_ALLOW_UNANONYMIZED === '1') return;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `data/clockwork-data.json is not valid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }

  if (parsed?.anonymized === true) return;

  const enforced = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const msg =
    'data/clockwork-data.json is not marked "anonymized": true. This site is public — ' +
    're-export with `clockwork ... export --anonymize`, or set ' +
    'METER_ALLOW_UNANONYMIZED=1 to publish it deliberately.';

  if (enforced) throw new Error(msg);
  console.warn(`[prepare-data] WARNING: ${msg}`);
}

async function main() {
  await mkdir(publicDir, { recursive: true });

  if (await exists(source)) {
    const raw = await readFile(source, 'utf8');
    assertAnonymized(raw);
    await copyFile(source, target);
    console.log('[prepare-data] Copied data/clockwork-data.json → public/');
  } else {
    await writeFile(target, `${JSON.stringify(buildSample(), null, 2)}\n`, 'utf8');
    console.log(
      '[prepare-data] No data/clockwork-data.json found — wrote generated sample to public/',
    );
  }
}

main().catch((err) => {
  console.error('[prepare-data] Failed:', err);
  process.exit(1);
});
