# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Constellations** is an Obsidian community plugin that replaces Obsidian's flat force-directed Graph View with a navigable 3D "star map": notes become stars, tags shared by ≥2 notes in the same top-level folder become constellations (linked by lines), top-level folders become "universes", and the most-connected note in the vault becomes a pulsating quasar. It's a TypeScript + Three.js plugin bundled with esbuild, built against the Obsidian Plugin API. There is no backend/server — everything runs client-side inside Obsidian's Electron/browser environment, reading the vault via the Obsidian API (`app.vault`, `app.metadataCache`).

## Repository structure

- `main.ts` — plugin entry point (`ConstellationsPlugin extends Plugin`). Registers the view, ribbon icon, settings tab, and three commands: `open-view`, `recenter-camera`, `rebuild-view`.
- `manifest.json` — Obsidian plugin manifest (id `constellations`, `minAppVersion` must cover every Obsidian API used).
- `versions.json` — maps plugin versions to minimum required Obsidian version; kept in sync with `manifest.json` by `npm version`.
- `esbuild.config.mjs` — esbuild bundler config. Entry point `main.ts` → bundles to `main.js` (CJS, target es2020). `obsidian`, `electron`, CodeMirror/Lezer packages, and Node builtins are marked `external` (provided by the Obsidian host at runtime, not bundled).
- `src/types.ts` — core data model: `StarNode`, `ConstellationGroup`, `UniverseGroup`, `ConstellationShape`, `ThreadStyle`.
- `src/graphBuilder.ts` — reads the vault (`app.vault.getMarkdownFiles()`, `app.metadataCache`) and builds the `UniverseGroup[]` model: groups notes into universes (top-level folder name, or `"Root"`), forms constellations from tags shared by ≥2 notes, and computes each star's connectivity `weight` (outgoing links/embeds + 1.5× backlinks + 0.5× unique tag count). Exposes `hashHue()` for deterministic per-tag coloring.
- `src/layout.ts` — pure 3D placement logic: positions universes/constellations on a jittered Vogel spiral, grows real spiral arms for universes with many constellations, clusters a dense "bulge" of untagged notes at each universe core, and pulls heavier stars toward their constellation center.
- `src/settings.ts` — `ConstellationsSettingTab`; currently just a "roll back to first published version" action that downloads release assets from GitHub via `requestUrl` and overwrites the installed plugin files.
- `src/view.ts` (largest file, ~1600 lines) — the Three.js `ItemView` (`ConstellationsView`, view type `constellations-view`): scene setup, custom GLSL shaders for twinkling/sparkle stars, constellation line/thread rendering, the quasar with particle jets, comets, `UnrealBloomPass` post-processing, `OrbitControls` camera, fly-to navigation, search/filter, `CSS2DRenderer`-based info panel and labels, and idle auto-rotate.
- `styles.css` — plugin UI styles, loaded automatically by Obsidian alongside `main.js`/`manifest.json`.
- `devtools/render-test/` — a standalone Playwright-driven visual test harness that renders the same Three.js scene (deliberately hand-duplicated from `src/view.ts`, not imported, per its own comment) against mock data (`mock-data.ts`) to screenshot layouts without needing a live Obsidian window. `build.mjs` bundles `render.ts` to `bundle.js`; `screenshot.mjs` drives headless Chromium (`swiftshader` software WebGL) via `index.html` and saves PNGs (overview, per-universe, and near/far group shots). Not wired into `package.json` scripts — run manually with `node devtools/render-test/build.mjs` then `node devtools/render-test/screenshot.mjs [outDir]`.
- `.github/workflows/release.yml` — on pushing a tag matching the `manifest.json` version (no `v` prefix), installs deps, runs `npm run build`, attests build provenance, and creates a GitHub Release with `main.js`, `manifest.json`, `styles.css` attached.
- `media/` — README GIFs.

## Build / run / test

Package manager: npm (`package-lock.json` present).

```bash
npm install
npm run dev     # esbuild watch mode -> rebuilds main.js on file changes (inline sourcemaps)
npm run build   # production build -> minified main.js, no sourcemap, exits after one build
npm run lint    # eslint src/*.ts main.ts
```

There is no automated unit test suite. The closest thing to a test is the manual visual harness in `devtools/render-test/` (see above), driven by Playwright, not run via `npm test` or CI.

To manually verify changes in Obsidian: symlink/copy this project folder into `<vault>/.obsidian/plugins/constellations/`, run `npm run dev`, enable the plugin in Obsidian, and use the **Rebuild view** command (command palette) to force the 3D scene to re-read the vault, or **Recenter camera** to reset the view.

Release flow: `npm version patch|minor|major` bumps `manifest.json`/`versions.json` together (via `version-bump.mjs`) and stages them; pushing a matching git tag triggers the release workflow.

## Conventions observed in this codebase

- Strict TypeScript (`strict: true`, `noImplicitAny: true`, `isolatedModules: true`, ES2020 target, tabs for indentation).
- `obsidian`, `electron`, and CodeMirror packages must stay in `esbuild.config.mjs`'s `external` list — never bundle them.
- Pure data/model logic (`graphBuilder.ts`, `layout.ts`, `types.ts`) is kept separate from rendering (`view.ts`); `view.ts` imports the model builders and only handles Three.js scene/DOM concerns.
- Deterministic pseudo-randomness: hues, constellation shapes, and thread styles are derived from `hashHue()` over string keys (tag name, or `key + "#shape"` / `key + "#thread"`) rather than `Math.random()`, so the same vault always lays out the same way across rebuilds.
- GLSL shader strings are tagged with `/* glsl */` template literal comments (for editor syntax highlighting) and kept as inline template strings in `view.ts`.
- JSDoc-style `/** ... */` comments are used liberally on exported types/fields in `src/types.ts` and on non-obvious constants to explain *why*, not just *what*.
- The eslint config specifically warns on `@typescript-eslint/no-unnecessary-type-assertion` and `@typescript-eslint/no-floating-promises` — these are flagged by Obsidian's official community-plugin review, so promises returned from callback contexts are explicitly `void`-prefixed (see `main.ts`).
- No React/Svelte/Vue — UI is built with Obsidian's own DOM helpers (`createEl`, `createDiv`, `Setting`, `Modal`) and raw Three.js/CSS2DRenderer, not a component framework.

## Gotchas / things to know

- `manifest.json`'s `minAppVersion` must cover every Obsidian API actually used — check before bumping API usage, since Obsidian's community-plugin submission review flags mismatches.
- The settings tab's "roll back" feature does a live network fetch (`requestUrl`) to `https://github.com/NikShukrem/obsidian-constellations/releases/download/...` — it depends on GitHub releases existing for `FIRST_PUBLISHED_VERSION` (`src/settings.ts`).
- `devtools/render-test` is intentionally *not* imported from `src/` — it duplicates rendering logic by hand and must be kept in sync manually when `src/view.ts`'s rendering changes (explicit comment in `devtools/render-test/render.ts`).
- Headless screenshot runs use `--use-gl=swiftshader` and retry screenshots if the PNG comes out suspiciously small (<20KB), because software WebGL sporadically renders a blank frame (see `screenshot.mjs`).
- This repo targets submission to Obsidian's official Community Plugins directory — see the "Publishing checklist" section in `README.md` for the exact requirements before changing `manifest.json`, `versions.json`, or the release workflow.
