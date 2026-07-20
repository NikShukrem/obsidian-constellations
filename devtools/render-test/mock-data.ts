import type { TFile } from "obsidian";
import * as THREE from "three";
import type {
	ConstellationGroup,
	ConstellationShape,
	StarNode,
	ThreadStyle,
	UniverseGroup,
} from "../../src/types";

function fakeFile(path: string): TFile {
	const slash = path.lastIndexOf("/");
	const basename = slash === -1 ? path : path.slice(slash + 1);
	// This harness never touches the real vault, so a structural stub is all
	// StarNode.file needs — casting through unknown avoids `any` without
	// hand-maintaining every unused TFile/TAbstractFile member.
	return { path, basename, extension: "md" } as unknown as TFile;
}

function makeStar(id: string, universe: string, weight: number, tags: string[]): StarNode {
	const base = id.split("/").pop() ?? id;
	return {
		id,
		name: base.replace(".md", ""),
		file: fakeFile(id),
		tags,
		universe,
		position: new THREE.Vector3(),
		weight,
		hue: 225,
	};
}

interface GroupSpec {
	size: number;
	shape?: ConstellationShape;
	threadStyle?: ThreadStyle;
}

function buildUniverse(name: string, groups: GroupSpec[], looseCount: number): UniverseGroup {
	const stars: StarNode[] = [];
	const constellations: ConstellationGroup[] = [];
	const shapes: ConstellationShape[] = ["ring", "arc", "cluster"];
	const threadStyles: ThreadStyle[] = ["filament", "stream"];
	let counter = 0;

	groups.forEach((spec, gi) => {
		const tag = `tag${gi}`;
		const groupStars: StarNode[] = [];
		for (let i = 0; i < spec.size; i++) {
			const star = makeStar(
				`${name}/${tag}-${i}-${counter++}.md`,
				name,
				1 + Math.random() * 10,
				[tag]
			);
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
			shape: spec.shape ?? shapes[gi % shapes.length],
			threadStyle: spec.threadStyle ?? threadStyles[gi % threadStyles.length],
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
	};
}

/** Mirrors the shape of a real vault with folder-tag extraction: a mix of
 * small clean tag groups and a few oversized ones (60-80 members) that must
 * fall back to a cloud-only look, plus every shape/thread-style combo forced
 * once each so they're all individually inspectable. */
export function buildMockGalaxy(): UniverseGroup[] {
	return [
		buildUniverse(
			"ShapeDemo",
			[
				{ size: 8, shape: "ring", threadStyle: "stream" },
				{ size: 8, shape: "arc", threadStyle: "filament" },
				{ size: 10, shape: "cluster", threadStyle: "stream" },
			],
			15
		),
		buildUniverse("MixedDemo", [
			{ size: 6 }, { size: 9 }, { size: 5 }, { size: 11 }, { size: 7 },
		], 25),
		buildUniverse(
			"BigFolderTags",
			[{ size: 60 }, { size: 80 }, { size: 25 }, { size: 6 }, { size: 4 }],
			40
		),
		buildUniverse("SmallOne", [{ size: 3, shape: "arc", threadStyle: "filament" }], 5),
		// Stress test: mirrors the real "04-Архивные-файлы" folder-tag group
		// (1200+ notes sharing one tag) that used to balloon the whole
		// universe's scale and wash out the screen with an oversized cloud.
		buildUniverse("MegaFolderTag", [{ size: 1243 }, { size: 8 }, { size: 5 }], 20),
	];
}
