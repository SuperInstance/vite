# ⚡ Vite Plugin Budget Guardian

**Show, don't sell.** This guardian measures Vite's plugin pipeline — how many plugins, how heavy the config, how big the chunks — and flags anything that breaks conservation budgets.

## What It Does

| Phase | Action |
|-------|--------|
| **Budget** | Sets limits: config size (10KB), plugin count (20), dist output (5MB), chunk size (250KB), CSS files (10) |
| **Profile** | Parses `vite.config.ts`, walks `dist/`, catalogs every chunk |
| **Detect** | Flags plugin bloat, oversized configs, fat chunks, CSS sprawl |
| **Report** | Human-readable table + JSON for CI integration |

## Quick Start

```bash
# From the Vite repo root (after build)
npx tsx guardian/plugin-budget-guardian.ts .

# With custom budgets
MAX_PLUGIN_COUNT=15 MAX_CHUNK_KB=150 npx tsx guardian/plugin-budget-guardian.ts .
```

## Sample Output

```
═══════════════════════════════════════════════
  ⚡ Vite Plugin Budget Guardian Report
═══════════════════════════════════════════════
  ── Config ──
  File      : vite.config.ts
  Size      : 1.8 KB
  Plugins   : 5
    • react
    • svgrPlugin
    • legacy
    • visualizer
    • compression

  ── Build Output ──
  Total     : 2.84 MB
  Chunks    : 12
  CSS files : 3

  Top 10 chunks:
       1.20 MB  assets/index-abc.js
       0.45 MB  assets/vendor-xyz.js
       0.30 MB  assets/index-def.css
       ...

  ✅ Plugin pipeline within conservation budget.
═══════════════════════════════════════════════
```

## Budget Defaults

| Metric | Default | Env Override |
|--------|---------|-------------|
| Config size | 10 KB | `MAX_CONFIG_KB` |
| Plugin count | 20 | `MAX_PLUGIN_COUNT` |
| Dist output | 5 MB | `MAX_DIST_MB` |
| Chunk size | 250 KB | `MAX_CHUNK_KB` |
| CSS files | 10 | `MAX_CSS_FILES` |

## Tests

```bash
npx vitest run guardian/plugin-budget-guardian.test.ts
```
