import * as THREE from "three";
import type { ConnectionStyle, ConstellationGroup, StarNode, UniverseGroup } from "../../src/types";

function fakeFile(path: string) {
	const slash = path.lastIndexOf("/");
	return { path, basename: slash === -1 ? path : path.slice(slash + 1), extension: "md" };
}

function makeStar(id: string, universe: string, weight: number, tags: string[]): StarNode {
	const base = id.split("/").pop() ?? id;
	return {
		id,
		name: base.replace(".md", ""),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		file: fakeFile(id) as any,
		tags,
		universe,
		position: new THREE.Vector3(),
		weight,
		hue: 225,
	};
}

function buildUniverse(
	name: string,
	connectionStyle: ConnectionStyle,
	groupSizes: number[],
	looseCount: number
): UniverseGroup {
	const stars: StarNode[] = [];
	const constellations: ConstellationGroup[] = [];
	let counter = 0;

	groupSizes.forEach((size, gi) => {
		const tag = `tag${gi}`;
		const groupStars: StarNode[] = [];
		for (let i = 0; i < size; i++) {
			const star = makeStar(`${name}/${tag}-${i}-${counter++}.md`, name, 1 + Math.random() * 10, [tag]);
			stars.push(star);
			groupStars.push(star);
		}
		const alphaStar = groupStars.reduce((a, b) => (b.weight > a.weight ? b : a));
		constellations.push({
			key: `${name}::${tag}`,
			tag,
			universe: name,
			stars: groupStars,
			center: new THREE.Vector3(),
			hue: (gi * 67) % 360,
			alphaStar,
			ringStars: [],
		});
	});

	for (let i = 0; i < looseCount; i++) {
		stars.push(makeStar(`${name}/loose-${i}-${counter++}.md`, name, 1 + Math.random() * 3, []));
	}

	return {
		name,
		stars,
		constellations,
		center: new THREE.Vector3(),
		radius: 0,
		alphaStar: stars.length ? stars.reduce((a, b) => (b.weight > a.weight ? b : a)) : null,
		connectionStyle,
	};
}

/** Mirrors the shape of a real vault with folder-tag extraction: a mix of
 * small clean tag groups and a few oversized ones (60-80 members) that must
 * fall back to a cloud instead of a line. One universe forced per style so
 * each is inspectable on its own, plus a stress universe with huge groups. */
export function buildMockGalaxy(): UniverseGroup[] {
	return [
		buildUniverse("StreamDemo", "stream", [4, 6, 8, 3, 5], 20),
		buildUniverse("FilamentDemo", "filament", [5, 7, 4, 9], 25),
		buildUniverse("NebulaDemo", "nebula", [6, 10, 4], 30),
		buildUniverse("BigFolderTags", "stream", [60, 80, 25, 6, 4], 40),
		buildUniverse("SmallOne", "filament", [3], 5),
	];
}
