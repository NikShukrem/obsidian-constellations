import { App, getAllTags, TFile } from "obsidian";
import * as THREE from "three";
import type { ConstellationGroup, ConstellationShape, StarNode, ThreadStyle, UniverseGroup } from "./types";

const CONSTELLATION_SHAPES: ConstellationShape[] = ["ring", "arc", "cluster"];
const THREAD_STYLES: ThreadStyle[] = ["filament", "stream"];

const ROOT_UNIVERSE_NAME = "Root";
export const DUST_HUE = 225;

function universeOf(file: TFile): string {
	const path = file.path;
	const slash = path.indexOf("/");
	if (slash === -1) return ROOT_UNIVERSE_NAME;
	return path.substring(0, slash);
}

/** Deterministic hue (0-360) so the same tag always gets the same color across rebuilds. */
export function hashHue(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
	}
	return hash % 360;
}

export function computeBacklinkCounts(app: App): Map<string, number> {
	const counts = new Map<string, number>();
	const resolved = app.metadataCache.resolvedLinks;
	for (const source in resolved) {
		const targets = resolved[source];
		for (const target in targets) {
			counts.set(target, (counts.get(target) ?? 0) + 1);
		}
	}
	return counts;
}

/** Connectivity-based weight shared by the full rebuild and the lightweight
 * per-file recompute used to detect "growth" on edit (see ConstellationsView). */
export function computeStarWeight(
	app: App,
	file: TFile,
	backlinkCounts: Map<string, number>
): number {
	const cache = app.metadataCache.getFileCache(file);
	const tags = cache ? getAllTags(cache) ?? [] : [];
	const tagCount = new Set(tags.map((t) => t.replace(/^#/, ""))).size;
	const outgoing = (cache?.links?.length ?? 0) + (cache?.embeds?.length ?? 0);
	const incoming = backlinkCounts.get(file.path) ?? 0;
	return 1 + outgoing + incoming * 1.5 + tagCount * 0.5;
}

export function buildGalaxy(app: App): UniverseGroup[] {
	const files = app.vault.getMarkdownFiles();
	const universeMap = new Map<string, UniverseGroup>();
	const backlinkCounts = computeBacklinkCounts(app);

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		const tags = cache ? getAllTags(cache) ?? [] : [];
		const cleanTags = Array.from(
			new Set(tags.map((t) => t.replace(/^#/, "")))
		);

		const universeName = universeOf(file);
		let universe = universeMap.get(universeName);
		if (!universe) {
			universe = {
				name: universeName,
				stars: [],
				constellations: [],
				center: new THREE.Vector3(),
				radius: 0,
				alphaStar: null,
			};
			universeMap.set(universeName, universe);
		}

		const weight = computeStarWeight(app, file, backlinkCounts);

		const star: StarNode = {
			id: file.path,
			name: file.basename,
			file,
			tags: cleanTags,
			universe: universeName,
			position: new THREE.Vector3(),
			weight,
			hue: DUST_HUE,
		};
		universe.stars.push(star);
	}

	for (const universe of universeMap.values()) {
		const byTag = new Map<string, StarNode[]>();
		for (const star of universe.stars) {
			for (const tag of star.tags) {
				const list = byTag.get(tag) ?? [];
				list.push(star);
				byTag.set(tag, list);
			}
		}
		for (const [tag, stars] of byTag) {
			if (stars.length < 2) continue;
			const alphaStar = stars.reduce((a, b) => (b.weight > a.weight ? b : a));
			const key = `${universe.name}::${tag}`;
			const group: ConstellationGroup = {
				key,
				tag,
				universe: universe.name,
				stars,
				center: new THREE.Vector3(),
				hue: hashHue(tag),
				alphaStar,
				ringStars: [],
				shape: CONSTELLATION_SHAPES[hashHue(key + "#shape") % CONSTELLATION_SHAPES.length],
				threadStyle: THREAD_STYLES[hashHue(key + "#thread") % THREAD_STYLES.length],
			};
			universe.constellations.push(group);
		}

		universe.alphaStar =
			universe.stars.length > 0
				? universe.stars.reduce((a, b) => (b.weight > a.weight ? b : a))
				: null;
	}

	return Array.from(universeMap.values());
}
