# Plugin Download Dashboard

An Obsidian plugin that charts community-plugin **download trends over time** and lets you
**watchlist** the plugins you want to track continuously.

## Why

The community releases repo publishes `community-plugin-stats.json` — but it only gives the
*cumulative* download count per release version, as a single current snapshot. You can see
that a plugin has most of its downloads on its latest release, but you can't see the *rate* or
*trend*: how downloads moved over time, or how a new release took off.

This plugin fixes that two ways:

1. **Reconstructed history** — it attributes each release's downloads to its GitHub publish date
   to draw a growth curve, so you get a trend immediately from a single snapshot.
2. **Live tracking** — once you watchlist a plugin, each refresh records a timestamped snapshot
   of its current downloads, building granular data over time (even within a single release).

## How it works

- **Browse** tab — search every community plugin; each is a clickable card. Opening one renders
  its dashboard **on the fly** from the live stats JSON (plus a GitHub call for release dates).
  Nothing is stored for browse-only plugins.
- **Watchlist** tab — plugins you're tracking. Hit **Watchlist** (👁) to start; from then on each
  refresh stores a snapshot. Unwatchlisting asks for confirmation and clears that plugin's data.
- **Dashboard** (per plugin) — a **line chart** of cumulative downloads over time, a **donut** of
  downloads by release, and a **table** of releases (release · published date · downloads).

### Data sources

- Downloads: `community-plugin-stats.json` (per-release counts) from the obsidian-releases repo.
- Release dates: the plugin repo's **GitHub Releases API** (`published_at`), cached per repo.
- An optional GitHub token (Settings) raises the GitHub API rate limit (60/hr unauthenticated).

## Install (manual)

Copy `main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/plugin-download-dashboard/`, then enable the plugin in
**Settings → Community plugins**.

## Develop

```bash
npm install
npm run dev     # watch build
npm run build   # production build (type-check + bundle)
npm test        # pure-model smoke tests
```

## License

MIT © Joe Utke
