# meter

A static dashboard for the [**clockwork CLI**](https://github.com/danielsich/clockwork).
You generate a JSON export locally with clockwork, `meter` bundles it with a
typed frontend viewer (Vite + TypeScript, no framework), and GitHub Actions
deploys the compiled `dist/` to GitHub Pages.

This repository is **independent of the clockwork source** — it only reads
clockwork's `export` output (schema `clockwork/v1`); it does not contain the CLI.

## Features

- **Activity & streaks** — current streak (live/ended), longest streak, and
  total active days, plus a GitHub-style last-12-weeks contribution calendar
  colored by daily minutes.
- **Project meter** — every project read as a bar against one shared graduated
  time-scale, sorted by time.
- **Per-project drill-downs** — click any row (keyboard-accessible) to expand
  key stats, a per-day bar chart, and that project's hour-of-day heatmap.
- **Hour-of-day heatmap** — a 24-hour strip showing when work happens, globally
  and per project. Needs a `--detail raw` export (the clockwork default); with a
  lighter export it hides and shows a hint instead.
- **Bring your own export** — load any `clockwork/v1` file in the browser
  (button or drag-and-drop), parsed locally and never uploaded.

Charts are built with CSS and inline SVG — no charting library, no runtime
dependencies. Features degrade gracefully when an export omits a field.

## The full loop

1. **Generate** the data locally with clockwork.
2. **Commit** `data/clockwork-data.json` and push to `main`.
3. GitHub Actions **builds** and **deploys** the static site to Pages.

The deployed site shows the published data by default, but **anyone can also
load their own export in the browser** — see [Load a file without
deploying](#load-a-file-without-deploying).

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

## Load a file without deploying

You don't have to deploy to view an export. On any running instance of the site
(local or deployed), visitors can view their own clockwork data:

- Click **Load .json** in the header and pick a file, **or**
- **Drag a `.json` file anywhere onto the page.**

The file is read **entirely in the browser** with the File API — it is **never
uploaded to a server or to GitHub**. It replaces what's on screen for that
session only; **Published data** returns to the deployed export. The same schema
guard applies, so a non-`clockwork/v1` file shows a clear message instead of
rendering.

This makes the deployed site usable as a plain viewer: point people at it and
they can inspect their own export without touching the repo.

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
