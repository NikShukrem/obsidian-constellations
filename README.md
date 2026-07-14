# Constellations

A 3D star map alternative to Obsidian's Graph View.

- **Note** → a star.
- **Shared tag** → a constellation: notes with a common tag inside the same
  folder are connected by lines, colored by a hue hashed from the tag.
- **Top-level folder** → a universe: its own region of space, with big
  universes (many tags) growing real spiral-arm structure and a dense core.

Untagged notes drift as background dust inside their universe. The heaviest
note in the vault (most links, backlinks, and tags) becomes a pulsating
quasar with particle jets; new notes flash into existence, and notes that
grow a lot in one edit flash as a "supernova" — without ever needing a full
scene rebuild.

## Features

- Click a star to fly the camera to it and open an info card: tags, a text
  preview of the note, and its constellation neighbors (click through them).
- Click a universe's name to fly out and frame the whole thing.
- Toolbar: jump back to the default view, or jump straight to any galaxy
  from a dropdown list.
- Twinkling stars, bloom, comets drifting through the background, idle
  auto-rotate.

## Installing

### From a release (manual)

1. Download `manifest.json`, `main.js`, and `styles.css` from the
   [latest release](https://github.com/NikShukrem/obsidian-constellations/releases).
2. Create `<vault>/.obsidian/plugins/constellations/` and put the three files
   there.
3. In Obsidian: Settings → Community plugins → enable "Constellations".

### Via BRAT (before it's in the community catalog)

Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, then
add this repository (`NikShukrem/obsidian-constellations`) as a beta plugin.
BRAT will keep it updated automatically.

## Development

```
npm install
npm run dev    # rebuilds main.js on file changes
npm run build  # production build
```

Symlink (or copy) the project folder into
`<vault>/.obsidian/plugins/constellations/` so Obsidian picks up rebuilds.
The **Rebuild Constellations view** command (in the command palette) forces
the 3D scene to re-read the vault if you've changed notes while the panel
was already open.

## How the layout works

- [src/graphBuilder.ts](src/graphBuilder.ts) — builds the model: universes
  (top-level folders), constellations (tags shared by ≥2 notes in the same
  universe), and each star's connectivity-based weight (links + backlinks +
  tags).
- [src/layout.ts](src/layout.ts) — places everything in 3D: universes and
  constellations on a jittered Vogel spiral so nothing perfectly overlaps;
  universes with many constellations grow spiral arms instead, with a dense
  "bulge" of untagged notes at the core; heavier stars gravitate toward the
  center of their constellation.
- [src/view.ts](src/view.ts) — the Three.js renderer: shader-based twinkling
  point stars, bloom post-processing, comets, the quasar, flash events for
  new/growing notes, camera fly-to, and the info panel.

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
