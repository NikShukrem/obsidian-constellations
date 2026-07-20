# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this project is

Constellations is an Obsidian community plugin that replaces Obsidian's built-in Graph View with an interactive 3D star map: notes render as stars, tags shared by ≥2 notes within the same top-level folder become "constellations" connected by lines, top-level folders become "universes", and the most-connected note becomes a pulsating quasar. Stack: TypeScript, Three.js for 3D rendering, esbuild for bundling, built against the Obsidian Plugin API. It is a pure client-side plugin (runs inside Obsidian's app process); there is no server component and no external API beyond an optional GitHub Releases download used by the in-app "roll back plugin version" feature.

## Repository layout

| Path | Purpose |
|---|---|
| `main.ts` | Plugin entry point. Registers the view, ribbon icon, settings tab, and commands (`open-view`, `recenter-camera`, `rebuild-view`). |
| `manifest.json` / `versions.json` | Obsidian plugin manifest and version-compatibility map. Must stay in sync (`npm version` does this via `version-bump.mjs`). |
| `esbuild.config.mjs` | Bundler config; entry `main.ts` -> `main.js`. `obsidian`, `electron`, CodeMirror/Lezer packages, and Node builtins are `external` — never bundle them. |
| `src/types.ts` | Core data model types: `StarNode`, `ConstellationGroup`, `UniverseGroup`. |
| `src/graphBuilder.ts` | Reads the vault via the Obsidian API and builds the universe/constellation/star model, including connectivity-based star `weight` and deterministic tag hue hashing (`hashHue`). |
| `src/layout.ts` | Pure 3D placement math (Vogel spiral layout, spiral arms, untagged-note bulge, weight-based centering). No Obsidian or DOM dependency. |
| `src/settings.ts` | Plugin settings tab; includes a "roll back to first published version" action that fetches release assets from GitHub. |
| `src/view.ts` | The Three.js `ItemView` implementation (~1600 lines): scene, custom GLSL shaders, bloom post-processing, camera fly-to, search, info panel, comets, quasar. |
| `styles.css` | Plugin UI styles. |
| `devtools/render-test/` | Manual, Playwright-based visual test harness. Duplicates rendering code from `src/view.ts` by hand (not imported) to screenshot layouts against mock data without a live Obsidian instance. Not wired into any npm script. |
| `.github/workflows/release.yml` | Builds and publishes a GitHub Release with `main.js`, `manifest.json`, `styles.css` when a tag matching the manifest version is pushed. |

## Build, run, test

Package manager: npm.

```bash
npm install
npm run dev     # esbuild watch build -> main.js, inline sourcemaps
npm run build   # production build -> minified main.js, no sourcemap
npm run lint    # eslint src/*.ts main.ts
```

There is no unit test suite and no `npm test` script. The only test-like tool is the manual visual harness in `devtools/render-test/`, run directly with `node devtools/render-test/build.mjs` followed by `node devtools/render-test/screenshot.mjs [outDir]` (requires `playwright` installed, headless Chromium with software WebGL).

To see changes live: symlink or copy the repo into `<vault>/.obsidian/plugins/constellations/`, run `npm run dev`, enable the plugin in Obsidian, then use the command-palette "Rebuild view" / "Recenter camera" commands.

Release: `npm version patch|minor|major` bumps and stages `manifest.json` + `versions.json`; pushing a git tag equal to the new version (no `v` prefix) triggers `release.yml`.

## Conventions to follow

- Strict TypeScript everywhere (`strict`, `noImplicitAny`, `isolatedModules` all on in `tsconfig.json`); tabs for indentation, ES2020 target.
- Keep the model/data layer (`graphBuilder.ts`, `layout.ts`, `types.ts`) free of Three.js scene/DOM concerns — those belong only in `view.ts`.
- Anything visually "random" (hue, constellation shape, thread style) must be derived deterministically from a string key via `hashHue()`, not `Math.random()`, so a given vault always lays out identically across rebuilds.
- GLSL shader source is written as `/* glsl */`-tagged template literals inline in `view.ts`.
- Fire-and-forget promises must be explicitly `void`-prefixed (e.g. `void this.activateView()`), and avoid unnecessary type assertions — both are enforced by `eslint.config.mjs` (`@typescript-eslint/no-floating-promises`, `@typescript-eslint/no-unnecessary-type-assertion`), which mirror checks in Obsidian's official community-plugin review.
- UI is built with Obsidian's native DOM helpers (`createEl`, `Setting`, `Modal`) and raw Three.js — there is no UI component framework (no React/Svelte/Vue).
- Never add `obsidian`, `electron`, or the CodeMirror/Lezer packages to the esbuild bundle — they must remain in the `external` list in `esbuild.config.mjs` since Obsidian provides them at runtime.

## Things to watch for

- `manifest.json`'s `minAppVersion` must cover every Obsidian API actually used by the code — check this before adding new Obsidian API calls, since it's checked by Obsidian's automated community-plugin review.
- `src/settings.ts`'s rollback feature makes a live network call to GitHub Releases (`https://github.com/NikShukrem/obsidian-constellations/releases/download/...`) — it assumes `FIRST_PUBLISHED_VERSION`'s release assets exist.
- `devtools/render-test/render.ts` intentionally duplicates rendering logic from `src/view.ts` rather than importing it (per its own top-of-file comment); if you change star/constellation rendering in `view.ts`, update the harness by hand too if it needs to keep matching.
- This repo is set up for submission to Obsidian's official Community Plugins directory. Before touching `manifest.json`, `versions.json`, or `.github/workflows/release.yml`, read the "Publishing checklist" section of `README.md`.
