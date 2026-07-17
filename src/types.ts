import type { TFile } from "obsidian";
import * as THREE from "three";

export interface StarNode {
	id: string;
	name: string;
	file: TFile;
	tags: string[];
	universe: string;
	position: THREE.Vector3;
	/** Connectivity-based weight (links + backlinks + tags). Heavier stars are
	 * bigger, brighter, and gravitate toward the center of their constellation. */
	weight: number;
	/** Hue (0-360) inherited from the star's primary constellation, or a neutral
	 * dust hue when the star belongs to no constellation. */
	hue: number;
	/** Raw outgoing + incoming link count (no tag bonus) — used only to decide
	 * whether a universe's alpha star is connected enough to anchor a
	 * planetary system. See MIN_SUN_WEIGHT/MIN_SUN_LINKS in graphBuilder.ts. */
	linkCount: number;
	/** Present only in planetary universes, only on non-sun stars. Recomputed
	 * every frame in ConstellationsView — position itself isn't touched by
	 * layoutGalaxy beyond the initial placement. */
	orbit?: {
		center: THREE.Vector3;
		radius: number;
		phase: number;
		speed: number;
		u: THREE.Vector3;
		v: THREE.Vector3;
	};
}

export interface ConstellationGroup {
	key: string;
	tag: string;
	universe: string;
	stars: StarNode[];
	center: THREE.Vector3;
	/** Deterministic hue (0-360) derived from the tag, used to color its stars and lines. */
	hue: number;
	/** Heaviest star in the group; the tag label is anchored next to it. */
	alphaStar: StarNode | null;
	/** Subset of `stars` actually drawn in this constellation's ring (each star
	 * has exactly one "home" constellation even if it carries several tags).
	 * Lines and the alpha-star anchor are derived from this, not `stars`, so
	 * a note's other tags don't drag long crossing lines across the map. */
	ringStars: StarNode[];
}

export interface UniverseGroup {
	name: string;
	stars: StarNode[];
	constellations: ConstellationGroup[];
	center: THREE.Vector3;
	radius: number;
	/** Heaviest star overall; the universe label is anchored next to it. */
	alphaStar: StarNode | null;
	/** True when alphaStar is connected enough to anchor a planetary system
	 * (see MIN_SUN_WEIGHT/MIN_SUN_LINKS in graphBuilder.ts). Weakly-connected
	 * universes stay on the regular constellation-shape layout. */
	isPlanetary: boolean;
	/** Same object as alphaStar, only set (and only meaningful) when isPlanetary. */
	sunStar: StarNode | null;
}
