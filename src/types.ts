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

export type ConnectionStyle = "filament" | "stream" | "nebula";

export interface UniverseGroup {
	name: string;
	stars: StarNode[];
	constellations: ConstellationGroup[];
	center: THREE.Vector3;
	radius: number;
	/** Heaviest star overall; the universe label is anchored next to it. */
	alphaStar: StarNode | null;
	/** How this universe's constellation connections render — deterministic
	 * per universe name so it doesn't change on rebuild. See graphBuilder.ts. */
	connectionStyle: ConnectionStyle;
}
