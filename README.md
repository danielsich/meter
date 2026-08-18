# meter

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/danielsich/meter)
[![Deploy](https://github.com/danielsich/meter/actions/workflows/deploy.yml/badge.svg)](https://github.com/danielsich/meter/actions/workflows/deploy.yml)
[![Live](https://img.shields.io/badge/live-meter.danielsich.com-blue)](https://meter.danielsich.com)

A static dashboard for the [clockwork CLI](https://github.com/danielsich/clockwork).
It displays clockwork exports in a dependency-free Vite and TypeScript frontend.
GitHub Actions deploys the compiled site to GitHub Pages. This repository does
not contain the clockwork CLI itself.

## Sample-only by design

The public site contains synthetic data. On each build,
`scripts/prepare-data.mjs` generates a valid `clockwork/v3` sample with synthetic
token and model usage
(`provider: "sample"`) relative to the build date. This keeps the streaks and
12-week calendar current without bundling real activity data.

You can still view your own export in the browser. See
[Load your own export](#load-your-own-export). The browser reads the file locally
and never uploads it. The deployed site has no way to publish personal data.

> **Never commit `data/clockwork-data.json`.** It is git-ignored, and CI fails the
> deploy if it is ever checked in, so personal data cannot reach GitHub Pages.

## Features

- The activity view covers your current and longest streaks, total active days,
  and the past 12 weeks.
- Projects share one time scale and are sorted by time logged.
- Token-enabled exports show model mix, cache reuse, tokens per response, and
  token intensity per project and day without estimating cost.
- Open any project row with a mouse or keyboard to see its stats, daily chart,
  and hourly activity.
- A 24-hour heatmap shows when work happens. This view needs a `--detail raw`
  export, which is clockwork's default. Lighter exports show a short explanation.
- Load any `clockwork/v1`, `clockwork/v2`, or `clockwork/v3` file with the file picker or by dragging it onto the
  page. The file stays in your browser.

The charts use CSS and inline SVG, with no charting library or runtime
dependencies. If an export omits a field, meter hides the affected view and
explains what data it needs.

## Load your own export

You do not need to deploy anything to view your data. On either the local or
public site:

- Click **Load .json** in the header and pick a file.
- Or drag a `.json` file anywhere onto the page.

The browser reads the file with the File API and does not upload it to a server
or GitHub. It replaces the current data for that tab. Select **Sample data** to
return to the built-in sample. If the file does not use a supported clockwork
schema, meter explains the problem instead of trying to render it.

Generate an export with clockwork:

```bash
clockwork both export --tokens > clockwork-data.json
```

Replace `both` with `claude` or `codex` to export one provider.

## Local development

```bash
npm install       # first run; also creates package-lock.json (commit it)
npm run dev       # Vite serves at http://localhost:5173/
```

The `dev` script runs `prepare-data.mjs` first, so the sample data is ready
before Vite starts.

Production preview (build, then serve `dist/` locally):

```bash
npm run build && npm run preview
```

## Deploy

Push to `main`, or run the **Deploy to GitHub Pages** workflow from the Actions
tab. GitHub Actions regenerates the sample data, builds the site, and deploys
`dist/` to Pages.

Enable Pages **before your first push**, or the first deploy fails:

> **Settings → Pages → Source → "GitHub Actions"**

## Data contract

The viewer renders exports matching schemas `clockwork/v1`, `clockwork/v2`, and
`clockwork/v3`. Token usage is opt-in in v3; exports without it keep every
existing view and show an instruction where model usage would appear. Any other
schema produces a clear error instead of a crash.

```jsonc
{
  "schema": "clockwork/v3",
  "generated_at": "2026-07-06T00:30:00+02:00",
  "provider": "both",                 // claude | codex | both | sample
  "tokens": true,                      // whether --tokens was used
  "projects": [
    {
      "id": "0ac6be84",
      "name": "project-1",            // display name
      "totals": { "minutes": 1234.76, "prompts": 1646, "sessions": 27, "active_days": 12 },
      "tokens": { "responses": 1800, "input": 31065, "output": 287747,
        "cache_read": 20753836, "cache_write": 579725, "reasoning": 0,
        "total": 21652373,
        "by_model": [{ "model": "claude-sonnet-4-6", "responses": 1800,
          "input": 31065, "output": 287747, "cache_read": 20753836,
          "cache_write": 579725, "reasoning": 0, "total": 21652373 }] }
    }
  ],
  "totals": { "projects": 1, "minutes": 1234.76, "prompts": 1646,
    "sessions": 27,
    "tokens": { "responses": 1800, "input": 31065, "output": 287747,
      "cache_read": 20753836, "cache_write": 579725, "reasoning": 0,
      "total": 21652373,
      "by_model": [{ "model": "claude-sonnet-4-6", "responses": 1800,
        "input": 31065, "output": 287747, "cache_read": 20753836,
        "cache_write": 579725, "reasoning": 0, "total": 21652373 }] } }
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
│  ├─ main.ts                # data loading, filters, and UI coordination
│  ├─ charts.ts              # activity and per-day chart rendering
│  ├─ projects.ts            # project rows, drill-downs, and deep-links
│  ├─ display.ts             # number, date, duration, and scale helpers
│  ├─ export-png.ts          # canvas-based PNG export
│  ├─ stats.ts               # streaks, ranges, aggregation
│  ├─ styles.css             # dark-mode styling
│  └─ clockwork.ts           # ClockworkExport / ClockworkProject types
├─ scripts/prepare-data.mjs  # generates the synthetic sample into public/
└─ .github/workflows/deploy.yml
```
