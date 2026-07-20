import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { layoutGalaxy } from "../../src/layout";
import type { UniverseGroup } from "../../src/types";
import { buildMockGalaxy } from "./mock-data";

// Kept in sync by hand with src/view.ts — this harness exists purely to
// screenshot layout/connection-style changes without needing a live
// Obsidian window, so it duplicates just the rendering bits, not the whole
// plugin (search, info panel, comets, quasar, etc. don't matter here).
const MAX_CONSTELLATION_LINE_MEMBERS = 14;
const DUST_HUE = 225;

const STAR_VERTEX_SHADER = /* glsl */ `
	attribute vec3 color;
	attribute float aPhase;
	uniform float uTime;
	uniform float uSize;
	uniform float uScale;
	uniform float uMaxSize;
	varying vec3 vColor;
	varying float vAlpha;
	void main() {
		vColor = color;
		float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + aPhase * 6.2831853);
		vAlpha = twinkle;
		vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
		gl_PointSize = min(uSize * uScale / -mvPosition.z, uMaxSize);
		gl_Position = projectionMatrix * mvPosition;
	}
`;
const STAR_FRAGMENT_SHADER = /* glsl */ `
	uniform sampler2D uMap;
	varying vec3 vColor;
	varying float vAlpha;
	void main() {
		vec4 tex = texture2D(uMap, gl_PointCoord);
		float a = tex.a * vAlpha;
		if (a < 0.02) discard;
		gl_FragColor = vec4(vColor, a);
	}
`;
const LINE_VERTEX_SHADER = /* glsl */ `
	attribute vec3 color;
	attribute float aProgress;
	attribute float aPhase;
	varying vec3 vColor;
	varying float vProgress;
	varying float vPhase;
	void main() {
		vColor = color;
		vProgress = aProgress;
		vPhase = aPhase;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;
const LINE_FRAGMENT_SHADER = /* glsl */ `
	uniform float uTime;
	uniform float uSpeed;
	uniform float uFade;
	varying vec3 vColor;
	varying float vProgress;
	varying float vPhase;
	void main() {
		float t = fract(uTime * uSpeed + vPhase);
		float trailDist = fract(t - vProgress);
		float glow = exp(-trailDist * trailDist * 45.0);
		float alpha = (0.22 + glow * 1.6) * uFade;
		gl_FragColor = vec4(vColor * alpha, alpha);
	}
`;

interface ThreadMaterial {
	material: THREE.ShaderMaterial | THREE.MeshBasicMaterial;
	baseOpacity: number;
}

interface GroupVisual {
	center: THREE.Vector3;
	nearDistance: number;
	farDistance: number;
	cloud: THREE.Sprite;
	cloudBaseOpacity: number;
	threads: ThreadMaterial[];
}

function createGlowTexture(): THREE.Texture {
	const size = 128;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	gradient.addColorStop(0, "rgba(255,255,255,1)");
	gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
	gradient.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size, size);
	return new THREE.CanvasTexture(canvas);
}

function createSparkleTexture(): THREE.Texture {
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	const cx = size / 2;
	const cy = size / 2;
	const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
	halo.addColorStop(0, "rgba(255,255,255,1)");
	halo.addColorStop(0.16, "rgba(255,255,255,0.9)");
	halo.addColorStop(0.4, "rgba(255,255,255,0.22)");
	halo.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = halo;
	ctx.fillRect(0, 0, size, size);
	ctx.globalCompositeOperation = "lighter";
	const drawSpike = (length: number, width: number, alpha: number) => {
		const grad = ctx.createLinearGradient(cx - length, cy, cx + length, cy);
		grad.addColorStop(0, "rgba(255,255,255,0)");
		grad.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
		grad.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = grad;
		ctx.fillRect(cx - length, cy - width / 2, length * 2, width);
	};
	const spikeAt = (angle: number, length: number, width: number, alpha: number) => {
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(angle);
		ctx.translate(-cx, -cy);
		drawSpike(length, width, alpha);
		ctx.restore();
	};
	spikeAt(0, size * 0.5, size * 0.045, 0.9);
	spikeAt(Math.PI / 2, size * 0.5, size * 0.045, 0.9);
	spikeAt(Math.PI / 4, size * 0.34, size * 0.02, 0.35);
	spikeAt((3 * Math.PI) / 4, size * 0.34, size * 0.02, 0.35);
	return new THREE.CanvasTexture(canvas);
}

function starColor(star: { hue: number; tags: string[]; weight: number }, minW: number, maxW: number): THREE.Color {
	const isDust = star.hue === DUST_HUE && star.tags.length === 0;
	const normW = maxW > minW ? (star.weight - minW) / (maxW - minW) : 0.5;
	const saturation = isDust ? 0.12 : 0.8 - normW * 0.3;
	const lightness = isDust ? 0.34 + normW * 0.2 : 0.5 + normW * 0.35;
	return new THREE.Color().setHSL(star.hue / 360, saturation, lightness);
}

async function main() {
	const universes = buildMockGalaxy();
	layoutGalaxy(universes);

	const width = 1600;
	const height = 1000;
	const canvas = document.createElement("canvas");
	document.body.appendChild(canvas);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x05050a);
	scene.fog = new THREE.FogExp2(0x05050a, 0.0011);

	const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 30000);
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(1);
	renderer.setSize(width, height);

	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.75, 0.5, 0.22);
	composer.addPass(bloom);

	scene.add(new THREE.AmbientLight(0xffffff, 1.2));
	const glowTexture = createGlowTexture();
	const starTexture = createSparkleTexture();

	// Background dust
	{
		const count = 1500;
		const geometry = new THREE.BufferGeometry();
		const positions = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			const radius = 3000 + Math.random() * 6000;
			const theta = Math.random() * Math.PI * 2;
			const phi = Math.acos(2 * Math.random() - 1);
			positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
			positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
			positions[i * 3 + 2] = radius * Math.cos(phi);
		}
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		const material = new THREE.PointsMaterial({
			color: 0x6c7086,
			size: 1.3,
			sizeAttenuation: false,
			transparent: true,
			opacity: 0.3,
			depthWrite: false,
			fog: false,
		});
		scene.add(new THREE.Points(geometry, material));
	}

	// Stars
	const allStars = universes.flatMap((u) => u.stars);
	{
		const weights = allStars.map((s) => s.weight);
		const minW = Math.min(...weights);
		const maxW = Math.max(...weights);
		const tierSizes = [4, 6.5, 10];
		const buckets: { positions: number[]; colors: number[]; phases: number[] }[] = [
			{ positions: [], colors: [], phases: [] },
			{ positions: [], colors: [], phases: [] },
			{ positions: [], colors: [], phases: [] },
		];
		for (const star of allStars) {
			const normW = maxW > minW ? (star.weight - minW) / (maxW - minW) : 0.5;
			const tier = normW < 0.4 ? 0 : normW < 0.75 ? 1 : 2;
			const bucket = buckets[tier];
			bucket.positions.push(star.position.x, star.position.y, star.position.z);
			const color = starColor(star, minW, maxW);
			bucket.colors.push(color.r, color.g, color.b);
			bucket.phases.push(Math.random());
		}
		buckets.forEach((bucket, tier) => {
			if (bucket.positions.length === 0) return;
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
			geometry.setAttribute("color", new THREE.Float32BufferAttribute(bucket.colors, 3));
			geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(bucket.phases, 1));
			const material = new THREE.ShaderMaterial({
				uniforms: {
					uTime: { value: 0.4 },
					uSize: { value: tierSizes[tier] },
					uScale: { value: 900 },
					uMaxSize: { value: 46 },
					uMap: { value: starTexture },
				},
				vertexShader: STAR_VERTEX_SHADER,
				fragmentShader: STAR_FRAGMENT_SHADER,
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			});
			scene.add(new THREE.Points(geometry, material));
		});
	}

	// Per-constellation cloud + thread, mirroring src/view.ts: every group
	// gets a soft volumetric glow sprite (visible from far away) plus its
	// filament/stream thread geometry (visible up close), crossfaded by
	// camera distance in updateGroupVisualFade below.
	const groupVisuals: GroupVisual[] = [];
	{
		const lineColor = new THREE.Color();
		for (const universe of universes) {
			for (const group of universe.constellations) {
				if (group.ringStars.length < 2) continue;
				let spanRadius = 0;
				for (const star of group.ringStars) {
					spanRadius = Math.max(spanRadius, group.center.distanceTo(star.position));
				}
				if (spanRadius === 0) continue;

				const cloudColor = new THREE.Color().setHSL(group.hue / 360, 0.6, 0.55);
				const cloudMaterial = new THREE.SpriteMaterial({
					map: glowTexture,
					color: cloudColor,
					transparent: true,
					opacity: 0.24,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
				});
				const cloud = new THREE.Sprite(cloudMaterial);
				cloud.position.copy(group.center);
				const cloudScale = Math.min(spanRadius * 2.6, 130);
				cloud.scale.set(cloudScale, cloudScale, 1);
				scene.add(cloud);

				const threads: ThreadMaterial[] = [];
				if (group.ringStars.length <= MAX_CONSTELLATION_LINE_MEMBERS) {
					if (group.threadStyle === "stream") {
						const positions: number[] = [];
						const colors: number[] = [];
						const progress: number[] = [];
						const phases: number[] = [];
						lineColor.setHSL(group.hue / 360, 0.7, 0.65);
						const groupPhase = Math.random();
						const cumulative = [0];
						for (let i = 1; i < group.ringStars.length; i++) {
							cumulative.push(
								cumulative[i - 1] +
									group.ringStars[i - 1].position.distanceTo(group.ringStars[i].position)
							);
						}
						const totalLength = cumulative[cumulative.length - 1] || 1;
						for (let i = 0; i < group.ringStars.length - 1; i++) {
							const a = group.ringStars[i].position;
							const b = group.ringStars[i + 1].position;
							positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
							colors.push(lineColor.r, lineColor.g, lineColor.b, lineColor.r, lineColor.g, lineColor.b);
							progress.push(cumulative[i] / totalLength, cumulative[i + 1] / totalLength);
							phases.push(groupPhase, groupPhase);
						}
						if (positions.length > 0) {
							const geometry = new THREE.BufferGeometry();
							geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
							geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
							geometry.setAttribute("aProgress", new THREE.Float32BufferAttribute(progress, 1));
							geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(phases, 1));
							const material = new THREE.ShaderMaterial({
								uniforms: { uTime: { value: 0.4 }, uSpeed: { value: 0.055 }, uFade: { value: 0 } },
								vertexShader: LINE_VERTEX_SHADER,
								fragmentShader: LINE_FRAGMENT_SHADER,
								transparent: true,
								depthWrite: false,
								blending: THREE.AdditiveBlending,
							});
							scene.add(new THREE.LineSegments(geometry, material));
							threads.push({ material, baseOpacity: 1 });
						}
					} else {
						// filament — real volume (tube), not a flat line, so it
						// reads as a soft gas strand instead of a thin scribble.
						const curve = new THREE.CatmullRomCurve3(group.ringStars.map((s) => s.position.clone()));
						const sampleCount = Math.max(16, group.ringStars.length * 8);
						const radius = 0.55;
						const color = new THREE.Color().setHSL(group.hue / 360, 0.65, 0.6);

						const tubeGeometry = new THREE.TubeGeometry(curve, sampleCount, radius, 6, false);
						const outerMaterial = new THREE.MeshBasicMaterial({
							color,
							transparent: true,
							opacity: 0,
							depthWrite: false,
							blending: THREE.AdditiveBlending,
						});
						scene.add(new THREE.Mesh(tubeGeometry, outerMaterial));
						threads.push({ material: outerMaterial, baseOpacity: 0.3 });

						// A thin brighter core so it doesn't look like a uniform blob.
						const coreGeometry = new THREE.TubeGeometry(curve, sampleCount, radius * 0.3, 5, false);
						const coreMaterial = new THREE.MeshBasicMaterial({
							color,
							transparent: true,
							opacity: 0,
							depthWrite: false,
							blending: THREE.AdditiveBlending,
						});
						scene.add(new THREE.Mesh(coreGeometry, coreMaterial));
						threads.push({ material: coreMaterial, baseOpacity: 0.55 });
					}
				}

				groupVisuals.push({
					center: group.center,
					nearDistance: spanRadius * 1.6,
					farDistance: spanRadius * 4.5,
					cloud,
					cloudBaseOpacity: 0.24,
					threads,
				});
			}
		}
	}

	function updateGroupVisualFade(cameraPos: THREE.Vector3) {
		for (const visual of groupVisuals) {
			const distance = cameraPos.distanceTo(visual.center);
			const span = Math.max(1, visual.farDistance - visual.nearDistance);
			const farFactor = THREE.MathUtils.clamp((distance - visual.nearDistance) / span, 0, 1);
			visual.cloud.material.opacity = visual.cloudBaseOpacity * farFactor;
			const nearFactor = 1 - farFactor;
			for (const { material, baseOpacity } of visual.threads) {
				if (material instanceof THREE.ShaderMaterial) {
					material.uniforms.uFade.value = baseOpacity * nearFactor;
				} else {
					material.opacity = baseOpacity * nearFactor;
				}
			}
		}
	}

	function render() {
		updateGroupVisualFade(camera.position);
		composer.render();
	}

	function frameUniverse(name: string, distanceMul = 1.3) {
		const universe = universes.find((u) => u.name === name);
		if (!universe) return;
		const dist = universe.radius * distanceMul + 10;
		camera.position.set(
			universe.center.x + dist * 0.6,
			universe.center.y + dist * 0.4,
			universe.center.z + dist
		);
		camera.lookAt(universe.center);
		render();
	}

	/** Frames a single constellation group up close so the thread geometry
	 * (which only shows once the camera has crossed inside nearDistance) is
	 * actually visible — frameUniverse alone can't verify the crossfade. */
	function frameGroup(universeName: string, tag: string, distanceMul = 0.55) {
		const universe = universes.find((u) => u.name === universeName);
		const group = universe?.constellations.find((g) => g.tag === tag);
		if (!group) return;
		const visual = groupVisuals.find((v) => v.center === group.center);
		const nearDist = visual ? visual.nearDistance : 15;
		const dist = Math.max(nearDist * distanceMul, 4);
		camera.position.set(
			group.center.x + dist * 0.6,
			group.center.y + dist * 0.4,
			group.center.z + dist
		);
		camera.lookAt(group.center);
		render();
	}

	function frameAll() {
		let maxDist = 0;
		for (const u of universes) maxDist = Math.max(maxDist, u.center.length() + u.radius);
		camera.position.set(maxDist * 0.5, maxDist * 0.5, maxDist * 1.1);
		camera.lookAt(0, 0, 0);
		render();
	}

	(
		window as unknown as {
			__frameUniverse: typeof frameUniverse;
			__frameGroup: typeof frameGroup;
			__frameAll: typeof frameAll;
			__universes: UniverseGroup[];
		}
	).__frameUniverse = frameUniverse;
	(window as unknown as { __frameGroup: typeof frameGroup }).__frameGroup = frameGroup;
	(window as unknown as { __frameAll: typeof frameAll }).__frameAll = frameAll;
	(window as unknown as { __universes: UniverseGroup[] }).__universes = universes;

	frameAll();
	(window as unknown as { __ready: boolean }).__ready = true;
}

void main();
