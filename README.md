<div align="center">

# Constellations

**A 3D star map alternative to Obsidian's Graph View.**

Notes become stars. Shared tags become constellations. Folders become
universes. Fly through your vault instead of staring at a flat force graph.

[![License: MIT](https://img.shields.io/github/license/NikShukrem/obsidian-constellations?color=8ab4ff)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/NikShukrem/obsidian-constellations?color=8ab4ff&sort=semver)](https://github.com/NikShukrem/obsidian-constellations/releases)
[![Minimum Obsidian version](https://img.shields.io/badge/Obsidian-%E2%89%A50.15.0-8ab4ff)](https://obsidian.md)

</div>

---

## What it does

| Vault concept                 | Becomes                                                          |
| ------------------------------ | ----------------------------------------------------------------- |
| A note                         | A star, sized and colored by how connected it is                  |
| A tag shared by ≥2 notes       | A constellation — its stars are linked by lines                   |
| A top-level folder             | A universe — its own region of space, spiral arms once it's big enough |
| The vault's most-connected note | A pulsating quasar with particle jets                             |
| A brand-new or fast-growing note | A flash — a "birth" or "supernova" — no rebuild needed          |

Untagged notes drift as a dense galactic bulge at the core of their universe.
Heavier (better-connected) notes gravitate toward the center of their
constellation. Everything is jittered off a mathematically perfect spiral so
it reads as a sky, not a diagram.

## Features

- **Fly-to navigation** — click any star to swoop the camera to it and open
  an info card: tags, a text preview of the note, and its constellation
  neighbors (click through them to keep exploring).
- **Galaxy jump list** — a toolbar dropdown of every universe in the vault;
  pick one to fly straight there.
- **Search** — filter stars by name or tag right in the toolbar; matches
  stay lit, everything else dims down; `Enter` flies to the nearest match.
- **Alive by default** — twinkling stars, bloom, comets drifting through the
  background, idle auto-rotate, all with no configuration required.

## Installing

### From a release (manual)

1. Download `manifest.json`, `main.js`, and `styles.css` from the
   [latest release](https://github.com/NikShukrem/obsidian-constellations/releases).
2. Create `<vault>/.obsidian/plugins/constellations/` and put the three files
   there.
3. In Obsidian: Settings → Community plugins → enable "Constellations".

### Via BRAT (before it's in the community catalog)

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then add this
repository (`NikShukrem/obsidian-constellations`) as a beta plugin. BRAT
keeps it updated automatically.

## Development

```bash
npm install
npm run dev    # rebuilds main.js on file changes
npm run build  # production build
```

Symlink (or copy) the project folder into
`<vault>/.obsidian/plugins/constellations/` so Obsidian picks up rebuilds.
The **Rebuild Constellations view** command (command palette) forces the 3D
scene to re-read the vault if notes changed while the panel was already
open; **Recenter Constellations camera** snaps back to the default view.

## How it's built

- [`src/graphBuilder.ts`](src/graphBuilder.ts) — builds the model: universes
  (top-level folders), constellations (tags shared by ≥2 notes in the same
  universe), and each star's connectivity-based weight (links + backlinks +
  tags).
- [`src/layout.ts`](src/layout.ts) — places everything in 3D: universes and
  constellations sit on a jittered Vogel spiral so nothing perfectly
  overlaps; universes with many constellations grow real spiral arms
  instead, with a dense bulge of untagged notes at the core; heavier stars
  gravitate toward the center of their constellation.
- [`src/view.ts`](src/view.ts) — the Three.js renderer: shader-based
  twinkling/sparkle point stars, bloom post-processing, comets, the quasar,
  flash events for new/growing notes, camera fly-to, search, and the info
  panel.

## Roadmap ideas

Not implemented yet, just on the shortlist:

- Black holes for orphaned notes (no links in or out).
- A pulsar-style faster flicker for recently-edited notes.
- Highlighting the star for whatever note is currently open in the editor.

## Publishing checklist (for maintainers)

This repo is set up to submit to Obsidian's official Community Plugins list:

- `manifest.json` has a unique `id`, `author`, `authorUrl`.
- `versions.json` maps plugin versions to the minimum Obsidian version.
- `npm version patch|minor|major` bumps `manifest.json`/`versions.json`
  together (see `version-bump.mjs`).
- Pushing a tag (matching the version in `manifest.json`, no `v` prefix)
  triggers `.github/workflows/release.yml`, which builds and attaches
  `main.js`, `manifest.json`, and `styles.css` to a GitHub Release.
- To submit: fork
  [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases),
  add an entry to `community-plugins.json`, and open a PR.

## License

MIT — see [LICENSE](LICENSE).
