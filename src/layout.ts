import * as THREE from "three";
import { DUST_HUE, hashHue } from "./graphBuilder";
import type { StarNode, UniverseGroup } from "./types";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPIRAL_ARM_MIN_GROUPS = 5;

export type ConstellationShape =
	| "ring"
	| "arc"
	| "zigzag"
	| "cluster"
	| "spiral"
	| "sphere"
	| "helix"
	| "starburst";
export const CONSTELLATION_SHAPES: ConstellationShape[] = [
	"ring",
	"arc",
	"zigzag",
	"cluster",
	"spiral",
	"sphere",
	"helix",
	"starburst",
];

/** Deterministic (stable across rebuilds) shape pick per constellation, so
 * they stop all reading as the same circle at different sizes. */
function pickShape(seed: string): ConstellationShape {
	return CONSTELLATION_SHAPES[hashHue(seed) % CONSTELLATION_SHAPES.length];
}

/** Local 3D layout for a constellation's stars, in the order they'll be
 * chain-connected. `pulls` (0-1 per star) still pulls heavier stars toward
 * the center on the shapes where "center" is a meaningful concept.
 *
 * "ring"/"arc"/"zigzag"/"spiral" stay genuinely flat (z stays 0, or close to
 * it) — real constellations *are* flat asterisms, and keeping some of them
 * that way is what makes the volumetric ones read as a deliberate shape
 * instead of everything being noise. "cluster"/"sphere"/"helix"/"starburst"
 * use all three axes on purpose. */
function shapePositions(
	shape: ConstellationShape,
	count: number,
	ringRadius: number,
	pulls: number[]
): { x: number; y: number; z: number }[] {
	const points: { x: number; y: number; z: number }[] = [];

	switch (shape) {
		case "zigzag": {
			// A wandering path with sharp random turns — closer to how real
			// asterisms (Orion's belt, the Big Dipper) actually read than a
			// tidy circle does. Wanders a bit out of plane too, not just
			// side to side.
			let angle = Math.random() * Math.PI * 2;
			let x = 0;
			let y = 0;
			let z = 0;
			points.push({ x, y, z });
			for (let i = 1; i < count; i++) {
				angle += (Math.random() - 0.5) * 2.3;
				const step = ringRadius * (0.55 + Math.random() * 0.45);
				x += Math.cos(angle) * step;
				y += Math.sin(angle) * step;
				z += (Math.random() - 0.5) * step * 0.5;
				points.push({ x, y, z });
			}
			const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
			const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
			const cz = points.reduce((s, p) => s + p.z, 0) / points.length;
			for (const p of points) {
				p.x -= cx;
				p.y -= cy;
				p.z -= cz;
			}
			break;
		}
		case "cluster": {
			// A genuine 3D nebula blob — random point inside a ball, denser
			// toward the middle for heavier stars — instead of a flat scatter
			// with a thin fuzz of depth on top.
			for (let i = 0; i < count; i++) {
				const dist = ringRadius * (0.25 + 0.85 * (1 - pulls[i])) * Math.cbrt(Math.random());
				const theta = Math.random() * Math.PI * 2;
				const phi = Math.acos(2 * Math.random() - 1);
				points.push({
					x: Math.sin(phi) * Math.cos(theta) * dist,
					y: Math.sin(phi) * Math.sin(theta) * dist,
					z: Math.cos(phi) * dist,
				});
			}
			break;
		}
		case "sphere": {
			// A hollow globular cluster: points spread evenly over a sphere
			// surface (golden-angle spiral sampling), heavier stars pulled
			// onto smaller inner shells rather than all sharing one radius.
			for (let i = 0; i < count; i++) {
				const t = count <= 1 ? 0.5 : i / (count - 1);
				const yy = 1 - t * 2;
				const radiusAtY = Math.sqrt(Math.max(0, 1 - yy * yy));
				const theta = i * GOLDEN_ANGLE;
				const shellRadius = ringRadius * (0.35 + 0.65 * (1 - pulls[i]));
				points.push({
					x: Math.cos(theta) * radiusAtY * shellRadius,
					y: Math.sin(theta) * radiusAtY * shellRadius,
					z: yy * shellRadius,
				});
			}
			break;
		}
		case "helix": {
			// A spring/DNA-helix winding through real depth, not just around
			// a flat circle.
			const turns = 1.5 + Math.random() * 1.3;
			for (let i = 0; i < count; i++) {
				const t = count <= 1 ? 0 : i / (count - 1);
				const angle = t * Math.PI * 2 * turns;
				const radius = ringRadius * 0.55;
				points.push({
					x: Math.cos(angle) * radius,
					y: Math.sin(angle) * radius,
					z: (t - 0.5) * ringRadius * 1.7,
				});
			}
			break;
		}
		case "starburst": {
			// Points radiating outward in random 3D directions, like a
			// supernova remnant frozen mid-expansion.
			for (let i = 0; i < count; i++) {
				const dir = randomOnSphereDirection();
				const dist = ringRadius * (0.2 + 0.9 * (1 - pulls[i])) * (0.4 + 0.6 * Math.random());
				points.push({ x: dir.x * dist, y: dir.y * dist, z: dir.z * dist });
			}
			break;
		}
		case "spiral": {
			for (let i = 0; i < count; i++) {
				const angle = i * GOLDEN_ANGLE;
				const radius = ringRadius * 0.34 * Math.sqrt(i + 0.5);
				points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: 0 });
			}
			break;
		}
		case "arc": {
			// An open arc instead of a closed loop — random sweep between a
			// quarter and three-quarters of a full circle.
			const span = Math.PI * (0.6 + Math.random() * 0.9);
			const start = Math.random() * Math.PI * 2;
			for (let i = 0; i < count; i++) {
				const t = count <= 1 ? 0 : i / (count - 1);
				const angle = start + t * span;
				const radius = ringRadius * (0.3 + 0.7 * (1 - pulls[i]));
				points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: 0 });
			}
			break;
		}
		case "ring":
		default: {
			for (let i = 0; i < count; i++) {
				const angle = (i / count) * Math.PI * 2;
				const radius = ringRadius * (0.3 + 0.7 * (1 - pulls[i]));
				points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: 0 });
			}
			break;
		}
	}

	return points;
}

function randomOnSphereDirection(): THREE.Vector3 {
	const u = Math.random();
	const v = Math.random();
	const theta = 2 * Math.PI * u;
	const phi = Math.acos(2 * v - 1);
	return new THREE.Vector3(
		Math.sin(phi) * Math.cos(theta),
		Math.sin(phi) * Math.sin(theta),
		Math.cos(phi)
	);
}

/** Vogel/sunflower spiral: points spaced by sqrt(index) at the golden angle
 * never overlap as long as `spacingUnit` covers each point's own footprint,
 * which is what keeps constellations (and universes) from piling on top of
 * each other the way fixed concentric rings used to. */
function vogelPoint(index: number, spacingUnit: number): { r: number; theta: number } {
	return { r: spacingUnit * Math.sqrt(index + 0.5), theta: index * GOLDEN_ANGLE };
}

/** Perturbs a polar point so the underlying spiral isn't perfectly readable —
 * a mathematically exact sunflower pattern looks like a diagram, not a sky. */
function jitterPolar(
	r: number,
	theta: number,
	radialSpread: number,
	angularSpread: number
): { r: number; theta: number } {
	return {
		r: r * (1 + (Math.random() - 0.5) * radialSpread),
		theta: theta + (Math.random() - 0.5) * angularSpread,
	};
}

/** A random orthonormal (u, v) basis spanning some plane through the origin.
 * Giving each constellation its own basis instead of always the world XZ
 * plane is what makes different constellations look tilted against each
 * other in 3D instead of every ring sitting flat on the same "floor". */
function randomPlaneBasis(): { u: THREE.Vector3; v: THREE.Vector3; normal: THREE.Vector3 } {
	const normal = randomOnSphereDirection();
	const arbitrary = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
	const u = new THREE.Vector3().crossVectors(normal, arbitrary).normalize();
	const v = new THREE.Vector3().crossVectors(normal, u).normalize();
	return { u, v, normal };
}

function chooseArmCount(groupCount: number): number {
	if (groupCount >= 16) return 4;
	if (groupCount >= 9) return 3;
	return 2;
}

function normalizedWeight(star: StarNode, minW: number, maxW: number): number {
	if (maxW <= minW) return 0.5;
	return (star.weight - minW) / (maxW - minW);
}

/** Picks, for each star, the constellation (tag group of size >= 2) with the
 * most members, so every star has exactly one "home" position even if it
 * carries several tags. */
function pickPrimaryConstellation(
	universe: UniverseGroup
): Map<string, string> {
	const primary = new Map<string, string>();
	const bySize = [...universe.constellations].sort(
		(a, b) => b.stars.length - a.stars.length || a.tag.localeCompare(b.tag)
	);
	for (const group of bySize) {
		for (const star of group.stars) {
			if (!primary.has(star.id)) primary.set(star.id, group.key);
		}
	}
	return primary;
}

/** Planetary layout for a universe whose alpha star is connected enough to
 * anchor one (see MIN_SUN_WEIGHT/MIN_SUN_LINKS in graphBuilder.ts): the sun
 * sits fixed at the universe center, everything else gets an orbit instead
 * of a spot on a constellation shape. Constellation tag groups still form
 * and still draw lines (ConstellationsView animates those to follow the
 * moving endpoints) — only the *positioning* skips shapes/spiral-arms/bulge. */
function layoutGalaxyPlanetary(universe: UniverseGroup): void {
	const sun = universe.sunStar;
	if (!sun) return;

	sun.position.copy(universe.center);
	sun.orbit = undefined;

	for (const group of universe.constellations) {
		group.ringStars = [];
		group.alphaStar = null;
	}

	const orbiting = universe.stars.filter((s) => s !== sun);
	if (orbiting.length === 0) return;

	const primaryOf = pickPrimaryConstellation(universe);
	const groupsByKey = new Map(universe.constellations.map((g) => [g.key, g]));
	const starsByGroup = new Map<string, StarNode[]>();
	for (const star of orbiting) {
		const key = primaryOf.get(star.id);
		if (!key) continue;
		const list = starsByGroup.get(key) ?? [];
		list.push(star);
		starsByGroup.set(key, list);
	}
	for (const [key, unsorted] of starsByGroup) {
		const group = groupsByKey.get(key);
		if (!group) continue;
		const sorted = [...unsorted].sort((a, b) => a.name.localeCompare(b.name));
		group.ringStars = sorted;
		group.alphaStar = sorted.reduce((a, b) => (b.weight > a.weight ? b : a));
	}

	const weights = orbiting.map((s) => s.weight);
	const minW = Math.min(...weights);
	const maxW = Math.max(...weights);
	const minOrbitRadius = 3.5;
	const maxOrbitRadius = Math.max(universe.radius, minOrbitRadius + 6);

	for (const star of orbiting) {
		// Heavier (more connected) notes orbit closer to the sun; a random
		// factor keeps same-weight stars from all landing on one shell.
		const pull = normalizedWeight(star, minW, maxW);
		const radius =
			minOrbitRadius +
			(maxOrbitRadius - minOrbitRadius) * (1 - pull) * (0.5 + 0.5 * Math.random());
		// Each star gets its own orbital plane so the whole system doesn't
		// flatten into one disc — more like a cloud of comets than rings.
		const { u, v } = randomPlaneBasis();
		const phase = Math.random() * Math.PI * 2;
		const speed = (0.05 + Math.random() * 0.12) / Math.sqrt(radius / minOrbitRadius);
		star.orbit = { center: universe.center.clone(), radius, phase, speed, u, v };
		star.position
			.copy(universe.center)
			.addScaledVector(u, Math.cos(phase) * radius)
			.addScaledVector(v, Math.sin(phase) * radius);

		const key = primaryOf.get(star.id);
		star.hue = key ? groupsByKey.get(key)!.hue : DUST_HUE;
	}
}

export function layoutGalaxy(universes: UniverseGroup[], forcedShape?: ConstellationShape): void {
	universes.sort((a, b) => b.stars.length - a.stars.length);

	const universeFootprints = universes.map(
		(u) => 20 + Math.sqrt(u.stars.length) * 7.5 + u.constellations.length * 5
	);
	const universeSpacing = Math.max(...universeFootprints, 1) * 2.6;

	universes.forEach((universe, i) => {
		universe.radius = universeFootprints[i];

		const base = vogelPoint(i, universeSpacing);
		const { r, theta } = jitterPolar(base.r, base.theta, 0.35, 0.4);
		universe.center.set(
			Math.cos(theta) * r,
			(Math.random() - 0.5) * 0.25 * r,
			Math.sin(theta) * r
		);

		if (universe.isPlanetary) {
			layoutGalaxyPlanetary(universe);
			return;
		}

		const primaryOf = pickPrimaryConstellation(universe);

		const sortedGroups = [...universe.constellations].sort(
			(a, b) => b.stars.length - a.stars.length || a.tag.localeCompare(b.tag)
		);
		const footprints = sortedGroups.map((g) => 2.4 + g.stars.length * 0.9);
		const localSpacing = Math.max(...footprints, 1) * 2.7;

		let farthestExtent = 0;

		// Universes with enough constellations get real galaxy structure —
		// a handful of spiral arms winding out from a reserved core — instead
		// of the generic jittered sunflower disc, so a bright "core" object
		// (quasar) actually looks like it belongs at the center of something.
		const useSpiralArms = sortedGroups.length >= SPIRAL_ARM_MIN_GROUPS;

		if (useSpiralArms) {
			const armCount = chooseArmCount(sortedGroups.length);
			const innerRadius = Math.max(...footprints, 1) * 1.4;
			const spiralTurns = 1.15;
			const perArmCount = Math.ceil(sortedGroups.length / armCount);
			const armProgress = new Array(armCount).fill(0);

			sortedGroups.forEach((group, gi) => {
				const armIndex = gi % armCount;
				const indexInArm = armProgress[armIndex]++;
				const along = vogelPoint(indexInArm, localSpacing);
				const progress = along.r / (localSpacing * Math.sqrt(perArmCount + 0.5));
				let localR = innerRadius + along.r;
				let localTheta =
					armIndex * ((Math.PI * 2) / armCount) + progress * spiralTurns * Math.PI * 2;
				({ r: localR, theta: localTheta } = jitterPolar(localR, localTheta, 0.18, 0.22));

				const offset = new THREE.Vector3(
					Math.cos(localTheta) * localR,
					(Math.random() - 0.5) * localSpacing * 0.22,
					Math.sin(localTheta) * localR
				);
				group.center.copy(universe.center).add(offset);
				farthestExtent = Math.max(farthestExtent, localR + footprints[gi]);
			});
		} else {
			sortedGroups.forEach((group, gi) => {
				const localBase = vogelPoint(gi, localSpacing);
				const { r: localR, theta: localTheta } = jitterPolar(
					localBase.r,
					localBase.theta,
					0.3,
					0.35
				);
				const offset = new THREE.Vector3(
					Math.cos(localTheta) * localR,
					(Math.random() - 0.5) * localSpacing * 0.3,
					Math.sin(localTheta) * localR
				);
				group.center.copy(universe.center).add(offset);
				farthestExtent = Math.max(farthestExtent, localR + footprints[gi]);
			});
		}

		if (farthestExtent > universe.radius) {
			universe.radius = farthestExtent * 1.1;
		}

		const groupsByKey = new Map(universe.constellations.map((g) => [g.key, g]));
		const placed = new Set<string>();
		const starsByGroup = new Map<string, StarNode[]>();

		for (const star of universe.stars) {
			const key = primaryOf.get(star.id);
			if (!key) continue;
			const list = starsByGroup.get(key) ?? [];
			list.push(star);
			starsByGroup.set(key, list);
		}

		for (const [key, unsorted] of starsByGroup) {
			const group = groupsByKey.get(key);
			if (!group) continue;
			// Same order drives ring placement and the connecting chain, so the
			// drawn lines trace an actual walk through the ring instead of
			// crossing back and forth between an arbitrary insertion order.
			const stars = [...unsorted].sort((a, b) => a.name.localeCompare(b.name));
			group.ringStars = stars;
			group.alphaStar = stars.reduce((a, b) => (b.weight > a.weight ? b : a));

			const ringRadius = 3.4 + stars.length * 1.3;
			const weights = stars.map((s) => s.weight);
			const minW = Math.min(...weights);
			const maxW = Math.max(...weights);
			const pulls = stars.map((s) => normalizedWeight(s, minW, maxW));
			// Each constellation gets its own tilted plane instead of everyone
			// sitting flat on the world XZ plane — real constellations don't
			// all share one orientation either.
			const { u, v, normal } = randomPlaneBasis();
			// ...and its own outline instead of everyone being a same-shaped
			// circle at a different size. u/v/normal already form a full 3D
			// basis, so shapes that carry real z (cluster/sphere/helix/
			// starburst) come out genuinely volumetric, not flattened.
			const shape = forcedShape ?? pickShape(group.key);
			const positions3d = shapePositions(shape, stars.length, ringRadius, pulls);
			stars.forEach((star, si) => {
				const { x, y, z } = positions3d[si];
				const jitter = ringRadius * 0.06;
				const jitterX = (Math.random() - 0.5) * jitter;
				const jitterY = (Math.random() - 0.5) * jitter;
				const jitterZ = (Math.random() - 0.5) * jitter;
				star.position
					.copy(group.center)
					.addScaledVector(u, x + jitterX)
					.addScaledVector(v, y + jitterY)
					.addScaledVector(normal, z + jitterZ);
				star.hue = group.hue;
				placed.add(star.id);
			});
		}

		for (const group of universe.constellations) {
			if (group.ringStars.length === 0) group.alphaStar = null;
		}

		// Untagged notes become the galactic bulge: instead of an even spread
		// through the whole volume, most cluster tightly near the core (which
		// spiral arms leave empty) and only a few stray out toward the arms.
		const looseStars = universe.stars.filter((s) => !placed.has(s.id));
		if (looseStars.length > 0) {
			const weights = looseStars.map((s) => s.weight);
			const minW = Math.min(...weights);
			const maxW = Math.max(...weights);
			for (const star of looseStars) {
				const pull = normalizedWeight(star, minW, maxW);
				// A floor keeps stars from literally stacking on top of each
				// other at the exact center (which used to blow up into giant
				// overlapping sprites once the camera flew in close).
				const dist =
					universe.radius *
					(0.15 + 0.55 * Math.pow(Math.random(), 1.35)) *
					(0.55 + 0.45 * (1 - pull));
				star.position
					.copy(universe.center)
					.add(randomOnSphereDirection().multiplyScalar(dist));
			}
		}
	});
}
