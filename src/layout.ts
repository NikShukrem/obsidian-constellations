import * as THREE from "three";
import type { StarNode, UniverseGroup } from "./types";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPIRAL_ARM_MIN_GROUPS = 5;

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

export function layoutGalaxy(universes: UniverseGroup[]): void {
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
			stars.forEach((star, si) => {
				const angle = (si / stars.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
				// Heavier stars (more links/backlinks/tags) are gravitationally
				// pulled toward the constellation's center; light stars drift outward.
				const pull = normalizedWeight(star, minW, maxW);
				const radius = ringRadius * (0.3 + 0.7 * (1 - pull));
				const jitter = (Math.random() - 0.5) * ringRadius * 0.25;
				star.position.set(
					group.center.x + Math.cos(angle) * (radius + jitter),
					group.center.y + (Math.random() - 0.5) * ringRadius * 0.45,
					group.center.z + Math.sin(angle) * (radius + jitter)
				);
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
				const dist =
					universe.radius * (0.2 + 0.5 * (1 - pull)) * Math.pow(Math.random(), 1.8);
				star.position
					.copy(universe.center)
					.add(randomOnSphereDirection().multiplyScalar(dist));
			}
		}
	});
}
