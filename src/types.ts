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

/** How a constellation's stars are arranged around its center. Varying this
 * per group is what keeps a starfield from reading as identical concentric
 * circles in every color. */
export type ConstellationShape = "ring" | "arc" | "cluster";

/** How a constellation's close-up connection renders once the camera is near
 * enough for the enveloping cloud to have faded out. Assigned per group (not
 * per universe) so a single universe shows a mix, not one style throughout. */
export type ThreadStyle = "filament" | "stream";

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
	 * Threads and the alpha-star anchor are derived from this, not `stars`, so
	 * a note's other tags don't drag long crossing connectors across the map. */
	ringStars: StarNode[];
	shape: ConstellationShape;
	threadStyle: ThreadStyle;
}

export interface UniverseGroup {
	name: string;
	stars: StarNode[];
	constellations: ConstellationGroup[];
	center: THREE.Vector3;
	radius: number;
	/** Heaviest star overall; the universe label is anchored next to it. */
	alphaStar: StarNode | null;
}
