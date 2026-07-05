# meter

A static dashboard for [**clockwork**](#), a separate CLI tool. You generate a
JSON export locally with clockwork, `meter` bundles it with a typed frontend
viewer (Vite + TypeScript, no framework), and GitHub Actions deploys the
compiled `dist/` to GitHub Pages.

This repository is **independent of the clockwork source** — it only reads
clockwork's `export` output (schema `clockwork/v1`); it does not contain the CLI.

## The full loop

1. **Generate** the data locally with clockwork.
2. **Commit** `data/clockwork-data.json` and push to `main`.
3. GitHub Actions **builds** and **deploys** the static site to Pages.

---

## One-time setup

Enable Pages **before your first push**, or the first deploy fails:

> **Settings → Pages → Source → “GitHub Actions.”**

## Generate the data locally

The site is public, so anonymize before exporting:

```bash
clockwork both export --anonymize > data/clockwork-data.json
```

- Use `claude` or `codex` instead of `both` to scope to one provider.
- You may drop `--anonymize` **only** if the repo is private, or you knowingly
  accept publishing real project paths.

`data/clockwork-data.json` is the **canonical source**. On every build,
`scripts/prepare-data.mjs` copies it into `public/clockwork-data.json` (which is
git-ignored and regenerated each build). If `data/clockwork-data.json` is
missing, a shape-valid **sample placeholder** is written instead, so a fresh
clone still builds and renders rather than erroring.

## ⚠️ Privacy warning

**GitHub Pages is public.** The JSON is served publicly **and stays in git
history permanently.** Without `--anonymize`, the export contains your real
project folder paths — anonymized exports replace them with `project-N` display
names. Only publish an un-anonymized export from a private repo you control.

## Deploy

Commit the data and the lockfile, then push:

```bash
git add data/clockwork-data.json package-lock.json
git commit -m "Update clockwork data"
git push origin main
```

Or trigger the **Deploy to GitHub Pages** workflow manually from the Actions tab
(`workflow_dispatch`).

## Base path

`vite.config.ts` sets `base: '/meter/'` to match the Pages subpath (the repo
name). **If you rename the repo, update `base` to match** — otherwise the
bundled JS/CSS assets 404 in production.

## Local development

```bash
npm install       # first time — also creates package-lock.json (commit it)
npm run dev       # Vite serves at http://localhost:5173/meter/
```

The `dev` script runs `prepare-data.mjs` automatically, so the data is ready
before Vite starts.

Production preview (build, then serve `dist/` locally):

```bash
npm run build && npm run preview
```

## Data contract

The viewer renders exports matching schema `clockwork/v1`. If `schema` is
anything else, it shows a clear error instead of crashing.

```jsonc
{
  "schema": "clockwork/v1",
  "generated_at": "2026-07-06T00:30:00+02:00",
  "provider": "both",                 // claude | codex | both
  "projects": [
    {
      "id": "0ac6be84",
      "name": "project-1",            // display name ("project-N" when anonymized)
      "totals": { "minutes": 1234.76, "prompts": 1646, "sessions": 27, "active_days": 12 }
    }
  ],
  "totals": { "projects": 6, "minutes": 3392.97, "prompts": 4588, "sessions": 64 }
}
```

Projects are listed sorted by `totals.minutes` descending. Extra per-project
fields (`path`, `daily`, `sessions`, `prompts`) are optional and ignored by the
MVP viewer.

## Project structure

```
meter/
├─ index.html                # Vite entry
├─ vite.config.ts            # base: '/meter/'
├─ tsconfig.json             # strict vanilla-ts
├─ package.json
├─ data/.gitkeep             # put clockwork-data.json here (canonical source)
├─ public/                   # prepare-data writes clockwork-data.json here at build
├─ src/
│  ├─ main.ts                # app logic + rendering
│  ├─ styles.css             # dark-mode styling
│  └─ clockwork.ts           # ClockworkExport / ClockworkProject types
├─ scripts/prepare-data.mjs  # copies data → public, with dummy fallback
└─ .github/workflows/deploy.yml
```
