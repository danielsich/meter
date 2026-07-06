# meter

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/danielsich/meter)
[![Deploy](https://github.com/danielsich/meter/actions/workflows/deploy.yml/badge.svg)](https://github.com/danielsich/meter/actions/workflows/deploy.yml)
[![Live](https://img.shields.io/badge/live-meter.danielsich.com-blue)](https://meter.danielsich.com)

A static dashboard for the [**clockwork CLI**](https://github.com/danielsich/clockwork).
It reads clockwork's `export` output (schema `clockwork/v1`) and renders it with a
typed, dependency-free frontend viewer (Vite + TypeScript, no framework). GitHub
Actions deploys the compiled `dist/` to GitHub Pages.

This repository is **independent of the clockwork source** — it only reads
clockwork's `export` output; it does not contain the CLI.

## Sample-only by design

The deployed site is a **public career showcase**, so the data it ships is
**synthetic**. On every build, `scripts/prepare-data.mjs` generates a shape-valid
`clockwork/v1` sample (`provider: "sample"`) relative to the build date, so
streaks and the 12-week calendar always look current. No real activity data is
ever bundled into the build.

Anyone can still view **their own** export in the browser — see
[Load your own export](#load-your-own-export). That file is read locally and
**never uploaded**, so there is intentionally no workflow for publishing personal
data to the deployed site.

> **Never commit `data/clockwork-data.json`.** It is git-ignored, and CI fails the
> deploy if it is ever checked in, so personal data cannot reach GitHub Pages.

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

## Load your own export

You don't need to deploy anything to view your data. On any running instance of
the site (local or deployed):

- Click **Load .json** in the header and pick a file, **or**
- **Drag a `.json` file anywhere onto the page.**

The file is read **entirely in the browser** with the File API — it is **never
uploaded to a server or to GitHub**. It replaces what's on screen for that
session only; **Sample data** returns to the built-in sample. A non-`clockwork/v1`
file shows a clear message instead of rendering.

Generate an export with clockwork:

```bash
clockwork both export > clockwork-data.json
```

Use `claude` or `codex` instead of `both` to scope to a single provider.

## Local development

```bash
npm install       # first time — also creates package-lock.json (commit it)
npm run dev       # Vite serves at http://localhost:5173/
```

The `dev` script runs `prepare-data.mjs` first, so the sample data is ready
before Vite starts.

Production preview (build, then serve `dist/` locally):

```bash
npm run build && npm run preview
```

## Deploy

Push to `main` (or trigger the **Deploy to GitHub Pages** workflow manually from
the Actions tab). GitHub Actions builds the site — regenerating the sample data —
and deploys `dist/` to Pages.

Enable Pages **before your first push**, or the first deploy fails:

> **Settings → Pages → Source → “GitHub Actions.”**

## Data contract

The viewer renders exports matching schema `clockwork/v1`. If `schema` is
anything else, it shows a clear error instead of crashing.

```jsonc
{
  "schema": "clockwork/v1",
  "generated_at": "2026-07-06T00:30:00+02:00",
  "provider": "both",                 // claude | codex | both | sample
  "projects": [
    {
      "id": "0ac6be84",
      "name": "project-1",            // display name
      "totals": { "minutes": 1234.76, "prompts": 1646, "sessions": 27, "active_days": 12 }
    }
  ],
  "totals": { "projects": 6, "minutes": 3392.97, "prompts": 4588, "sessions": 64 }
}
```

Projects are listed sorted by `totals.minutes` descending. Extra per-project
fields (`path`, `daily`, `sessions`, `prompts`) are optional and used by the
drill-downs when present.

## Project structure

```
meter/
├─ index.html                # Vite entry
├─ vite.config.ts            # base: '/', build-time CSP injection
├─ tsconfig.json             # strict vanilla-ts
├─ package.json
├─ public/
│  ├─ privacy.html           # GDPR Art. 13 privacy notice
│  ├─ imprint.html           # § 18(1) MStV / § 5 DDG imprint
│  ├─ licenses.html          # OFL-1.1 font licence notice
│  ├─ fonts/                 # self-hosted Space Grotesk + JetBrains Mono
│  └─ clockwork-data.json    # generated sample, written by prepare-data at build (git-ignored)
├─ src/
│  ├─ main.ts                # app logic + rendering
│  ├─ stats.ts               # streaks, ranges, aggregation
│  ├─ styles.css             # dark-mode styling
│  └─ clockwork.ts           # ClockworkExport / ClockworkProject types
├─ scripts/prepare-data.mjs  # generates the synthetic sample into public/
└─ .github/workflows/deploy.yml
```
