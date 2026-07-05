import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'data', 'clockwork-data.json');
const publicDir = join(root, 'public');
const target = join(publicDir, 'clockwork-data.json');

const DUMMY = {
  schema: 'clockwork/v1',
  generated_at: '1970-01-01T00:00:00Z',
  provider: 'sample',
  projects: [
    {
      id: 'sample',
      name: 'sample-project',
      totals: { minutes: 125, prompts: 42, sessions: 3, active_days: 2 },
    },
  ],
  totals: { projects: 1, minutes: 125, prompts: 42, sessions: 3 },
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(publicDir, { recursive: true });

  if (await exists(source)) {
    await copyFile(source, target);
    console.log('[prepare-data] Copied data/clockwork-data.json → public/');
  } else {
    await writeFile(target, `${JSON.stringify(DUMMY, null, 2)}\n`, 'utf8');
    console.log(
      '[prepare-data] No data/clockwork-data.json found — wrote sample placeholder to public/',
    );
  }
}

main().catch((err) => {
  console.error('[prepare-data] Failed:', err);
  process.exit(1);
});
