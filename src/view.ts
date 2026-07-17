import { ItemView, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
	CSS2DObject,
	CSS2DRenderer,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
	buildGalaxy,
	computeBacklinkCounts,
	computeStarWeight,
	DUST_HUE,
	hashHue,
} from "./graphBuilder";
import { layoutGalaxy } from "./layout";
import type { ConstellationGroup, StarNode, UniverseGroup } from "./types";

/** A real constellation is a handful of stars, not a whole subfolder — tag
 * groups bigger than this skip line/filament rendering (still color and
 * position their stars normally, and nebula-style groups aren't affected
 * since a cloud doesn't care how many members it has). */
const MAX_CONSTELLATION_LINE_MEMBERS = 14;
import type ConstellationsPlugin from "../main";

export const VIEW_TYPE_CONSTELLATIONS = "constellations-view";

const DUST_BACKGROUND_COLOR = new THREE.Color(0x6c7086);
const STAR_LABEL_DISTANCE = 26;
const MAX_VISIBLE_STAR_LABELS = 22;
const TAG_LABEL_DISTANCE = 140;
const DEFAULT_CAMERA_POS = new THREE.Vector3(0, 60, 160);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
const IDLE_ROTATE_DELAY = 12000;
const COMET_COUNT = 6;
const COMET_TRAIL_LENGTH = 10;
const COMET_TRAIL_SPACING = 15;

const STAR_VERTEX_SHADER = /* glsl */ `
	attribute vec3 color;
	attribute float aPhase;
	attribute float aDim;
	uniform float uTime;
	uniform float uSize;
	uniform float uScale;
	uniform float uMaxSize;
	varying vec3 vColor;
	varying float vAlpha;

	void main() {
		vColor = color;
		float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + aPhase * 6.2831853);
		vAlpha = twinkle * aDim;
		vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
		// Clamped so a star the camera happens to fly right next to doesn't
		// blow up into a giant blob covering half the screen.
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

// Quasar jet: particles stream outward from the origin along the axis with a
// widening cone (fountain), fading in then out along their lifetime.
const JET_VERTEX_SHADER = /* glsl */ `
	attribute float aPhase;
	attribute float aAngle;
	attribute float aRadius;
	uniform float uTime;
	uniform float uLength;
	uniform float uSpeed;
	uniform vec3 uOrigin;
	uniform vec3 uAxis;
	uniform vec3 uPerpU;
	uniform vec3 uPerpV;
	uniform float uSize;
	uniform float uScale;
	uniform float uMaxSize;
	varying float vAlpha;

	void main() {
		float t = fract(aPhase + uTime * uSpeed);
		float spread = t * t * aRadius;
		vec3 offset = uAxis * (t * uLength) + (uPerpU * cos(aAngle) + uPerpV * sin(aAngle)) * spread;
		vec3 pos = uOrigin + offset;
		vAlpha = sin(t * 3.14159265);
		vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
		gl_PointSize = min(uSize * uScale / -mvPosition.z, uMaxSize);
		gl_Position = projectionMatrix * mvPosition;
	}
`;

const JET_FRAGMENT_SHADER = /* glsl */ `
	uniform sampler2D uMap;
	uniform vec3 uColor;
	varying float vAlpha;

	void main() {
		vec4 tex = texture2D(uMap, gl_PointCoord);
		float a = tex.a * vAlpha;
		if (a < 0.02) discard;
		gl_FragColor = vec4(uColor, a);
	}
`;

// Constellation lines: a bright point runs along each constellation's path
// (aProgress = normalized distance along that constellation, aPhase = a
// per-constellation offset so they don't all pulse in sync) leaving a
// fading comet-tail behind it. The base line never drops below a floor so
// the constellation shape stays readable between passes.
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
	varying vec3 vColor;
	varying float vProgress;
	varying float vPhase;

	void main() {
		float t = fract(uTime * uSpeed + vPhase);
		float trailDist = fract(t - vProgress);
		float glow = exp(-trailDist * trailDist * 45.0);
		float alpha = 0.22 + glow * 1.6;
		gl_FragColor = vec4(vColor * alpha, alpha);
	}
`;

interface CSS2DEntry<T> {
	item: T;
	obj: CSS2DObject;
}

interface FlightState {
	start: number;
	duration: number;
	fromPos: THREE.Vector3;
	toPos: THREE.Vector3;
	fromTarget: THREE.Vector3;
	toTarget: THREE.Vector3;
}

interface Comet {
	start: THREE.Vector3;
	end: THREE.Vector3;
	startTime: number;
	duration: number;
	head: THREE.Sprite;
	trail: THREE.Line;
}

interface Flash {
	sprite: THREE.Sprite;
	start: number;
	duration: number;
	maxScale: number;
}

function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function starColor(star: StarNode, minWeight: number, maxWeight: number): THREE.Color {
	const isDust = star.hue === DUST_HUE && star.tags.length === 0;
	const normW =
		maxWeight > minWeight ? (star.weight - minWeight) / (maxWeight - minWeight) : 0.5;
	const saturation = isDust ? 0.12 : 0.8 - normW * 0.3;
	const lightness = isDust ? 0.34 + normW * 0.2 : 0.5 + normW * 0.35;
	return new THREE.Color().setHSL(star.hue / 360, saturation, lightness);
}

function starWeightNorm(star: StarNode, minWeight: number, maxWeight: number): number {
	return maxWeight > minWeight ? (star.weight - minWeight) / (maxWeight - minWeight) : 0.5;
}

export class ConstellationsView extends ItemView {
	private plugin: ConstellationsPlugin;
	private renderer: THREE.WebGLRenderer | null = null;
	private composer: EffectComposer | null = null;
	private bloomPass: UnrealBloomPass | null = null;
	private labelRenderer: CSS2DRenderer | null = null;
	private scene: THREE.Scene | null = null;
	private camera: THREE.PerspectiveCamera | null = null;
	private controls: OrbitControls | null = null;
	private glowTexture: THREE.Texture | null = null;
	private starTexture: THREE.Texture | null = null;
	private starLayers: THREE.Points[] = [];
	private starMaterials: THREE.ShaderMaterial[] = [];
	private lineMaterial: THREE.ShaderMaterial | null = null;
	private starsByLayer: StarNode[][] = [];
	private starIndex = new Map<string, { layer: number; vertexIndex: number }>();
	private searchQuery = "";
	private searchActive = false;
	private searchMatches = new Set<string>();
	private searchDebounce: number | null = null;
	private pointScale = 800;
	private raycaster = new THREE.Raycaster();
	private pointer = new THREE.Vector2();
	private stars: StarNode[] = [];
	private groupsByStar = new Map<string, ConstellationGroup[]>();
	private starLabels: CSS2DEntry<StarNode>[] = [];
	private tagLabels: CSS2DEntry<ConstellationGroup>[] = [];
	private tooltipEl: HTMLDivElement | null = null;
	private infoPanelEl: HTMLDivElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private animationHandle = 0;
	private flight: FlightState | null = null;
	private idleTimer: number | null = null;
	private comets: Comet[] = [];
	private cometsGroup: THREE.Group | null = null;
	private quasarHalo: THREE.Sprite | null = null;
	private quasarBaseScale = 1;
	private quasarJetMaterials: THREE.ShaderMaterial[] = [];
	private activeFlashes: Flash[] = [];
	private nebulae: { sprite: THREE.Sprite; center: THREE.Vector3; radius: number; baseOpacity: number }[] = [];
	private weightSnapshot = new Map<string, number>();
	private starPositionByPath = new Map<string, THREE.Vector3>();
	private rebuildTimer: number | null = null;
	private changeDebounceTimers = new Map<string, number>();
	private currentUniverses: UniverseGroup[] = [];
	private toolbarEl: HTMLDivElement | null = null;
	private galaxyMenuEl: HTMLDivElement | null = null;
	private galaxyMenuOpen = false;
	private onPointerMove = (ev: PointerEvent) => this.handlePointerMove(ev);
	private onClick = (ev: MouseEvent) => this.handleClick(ev);
	private onDocumentClick = (ev: MouseEvent) => {
		if (!this.galaxyMenuOpen || !this.toolbarEl) return;
		if (!this.toolbarEl.contains(ev.target as Node)) {
			this.galaxyMenuOpen = false;
			this.galaxyMenuEl?.hide();
		}
	};

	constructor(leaf: WorkspaceLeaf, plugin: ConstellationsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CONSTELLATIONS;
	}

	getDisplayText(): string {
		return "Constellations";
	}

	getIcon(): string {
		return "sparkles";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("constellations-container");

		const mount = container.createDiv({ cls: "constellations-canvas-mount" });
		this.tooltipEl = container.createDiv({ cls: "constellations-tooltip" });
		this.tooltipEl.hide();
		this.infoPanelEl = container.createDiv({ cls: "constellations-info-panel" });
		this.infoPanelEl.hide();

		const toolbar = container.createDiv({ cls: "constellations-toolbar" });
		this.toolbarEl = toolbar;
		const homeBtn = toolbar.createEl("button", { cls: "ct-btn", text: "Основной вид" });
		homeBtn.onclick = () => this.resetCamera();

		const dropdownWrap = toolbar.createDiv({ cls: "ct-dropdown" });
		const dropdownBtn = dropdownWrap.createEl("button", { cls: "ct-btn", text: "Галактики" });
		const dropdownMenu = dropdownWrap.createDiv({ cls: "ct-dropdown-menu" });
		dropdownMenu.hide();
		this.galaxyMenuEl = dropdownMenu;
		dropdownBtn.onclick = (ev) => {
			ev.stopPropagation();
			this.galaxyMenuOpen = !this.galaxyMenuOpen;
			if (this.galaxyMenuOpen) dropdownMenu.show();
			else dropdownMenu.hide();
		};
		activeDocument.addEventListener("click", this.onDocumentClick);

		const searchInput = toolbar.createEl("input", {
			cls: "ct-search-input",
			type: "text",
			placeholder: "Найти заметку или #тег…",
		});
		searchInput.addEventListener("input", () => {
			const value = searchInput.value;
			if (this.searchDebounce !== null) window.clearTimeout(this.searchDebounce);
			this.searchDebounce = window.setTimeout(() => {
				this.searchDebounce = null;
				this.applySearch(value);
			}, 120);
		});
		searchInput.addEventListener("keydown", (ev) => {
			ev.stopPropagation();
			if (ev.key === "Enter") {
				ev.preventDefault();
				this.applySearch(searchInput.value);
				this.flyToFirstMatch();
			} else if (ev.key === "Escape") {
				searchInput.value = "";
				this.applySearch("");
				searchInput.blur();
			}
		});

		this.initScene(mount);
		this.rebuild();

		mount.addEventListener("pointermove", this.onPointerMove);
		mount.addEventListener("click", this.onClick);

		this.resizeObserver = new ResizeObserver(() => this.handleResize(mount));
		this.resizeObserver.observe(mount);

		this.registerEvent(
			this.plugin.app.vault.on("create", (file) => this.handleFileCreated(file))
		);
		this.registerEvent(
			this.plugin.app.metadataCache.on("changed", (file) => this.handleFileChanged(file))
		);

		this.scheduleIdleAutoRotate();
		this.animate();
	}

	async onClose(): Promise<void> {
		if (this.animationHandle) window.cancelAnimationFrame(this.animationHandle);
		if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
		if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
		if (this.searchDebounce !== null) window.clearTimeout(this.searchDebounce);
		for (const timer of this.changeDebounceTimers.values()) window.clearTimeout(timer);
		activeDocument.removeEventListener("click", this.onDocumentClick);
		this.resizeObserver?.disconnect();
		this.controls?.dispose();
		this.renderer?.dispose();
		this.renderer?.domElement.remove();
		this.labelRenderer?.domElement.remove();
		this.glowTexture?.dispose();
		this.starTexture?.dispose();
		for (const comet of this.comets) {
			comet.trail.geometry.dispose();
			(comet.trail.material as THREE.Material).dispose();
			(comet.head.material as THREE.Material).dispose();
		}
	}

	public rebuild(): void {
		if (!this.scene) return;
		this.clearGalaxy();

		const universes = buildGalaxy(this.plugin.app);
		layoutGalaxy(universes);
		this.populateScene(universes);
	}

	public resetCamera(): void {
		this.flyCameraTo(DEFAULT_CAMERA_POS.clone(), DEFAULT_CAMERA_TARGET.clone());
	}

	private initScene(mount: HTMLElement): void {
		const width = mount.clientWidth || 800;
		const height = mount.clientHeight || 600;

		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x05050a);
		scene.fog = new THREE.FogExp2(0x05050a, 0.0011);

		const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 30000);
		camera.position.copy(DEFAULT_CAMERA_POS);

		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(activeWindow.devicePixelRatio, 2));
		renderer.setSize(width, height);
		mount.appendChild(renderer.domElement);

		const composer = new EffectComposer(renderer);
		composer.addPass(new RenderPass(scene, camera));
		const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 1.1, 0.55, 0.12);
		composer.addPass(bloom);

		const labelRenderer = new CSS2DRenderer();
		labelRenderer.setSize(width, height);
		labelRenderer.domElement.addClass("constellations-label-layer");
		mount.appendChild(labelRenderer.domElement);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.08;
		controls.rotateSpeed = 0.5;
		controls.zoomSpeed = 0.9;
		controls.minDistance = 1.2;
		controls.maxDistance = 20000;
		controls.autoRotateSpeed = 0.35;
		controls.addEventListener("start", () => this.clearIdleTimer());
		controls.addEventListener("end", () => this.scheduleIdleAutoRotate());

		this.raycaster.params.Points = { threshold: 1.4 };

		scene.add(new THREE.AmbientLight(0xffffff, 1.2));
		this.glowTexture = this.createGlowTexture();
		this.starTexture = this.createSparkleTexture();
		this.addBackgroundDust(scene);

		this.scene = scene;
		this.camera = camera;
		this.renderer = renderer;
		this.composer = composer;
		this.bloomPass = bloom;
		this.labelRenderer = labelRenderer;
		this.controls = controls;

		this.pointScale = this.computePointScale();
		this.initComets();
	}

	private computePointScale(): number {
		if (!this.camera || !this.renderer) return 800;
		const size = new THREE.Vector2();
		this.renderer.getSize(size);
		const fovRad = (this.camera.fov * Math.PI) / 180;
		return (size.y / (2 * Math.tan(fovRad / 2))) * this.renderer.getPixelRatio();
	}

	private createGlowTexture(): THREE.Texture {
		const size = 128;
		const canvas = activeDocument.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d");
		if (ctx) {
			const gradient = ctx.createRadialGradient(
				size / 2,
				size / 2,
				0,
				size / 2,
				size / 2,
				size / 2
			);
			gradient.addColorStop(0, "rgba(255,255,255,1)");
			gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
			gradient.addColorStop(1, "rgba(255,255,255,0)");
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, size, size);
		}
		return new THREE.CanvasTexture(canvas);
	}

	/** A soft core plus four (and four fainter diagonal) diffraction spikes —
	 * the "aesthetic sparkle star" look, not just a blurry dot. Stays grayscale
	 * so the per-star hue tint from the shader still comes through. */
	private createSparkleTexture(): THREE.Texture {
		const size = 256;
		const canvas = activeDocument.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d");
		if (ctx) {
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
		}
		return new THREE.CanvasTexture(canvas);
	}

	/** Purely decorative backdrop — deliberately kept far outside the range
	 * any real universe can reach (see the spacing math in layout.ts) and
	 * rendered without size attenuation, so it can never drift close enough
	 * to be mistaken for a clickable note the way it used to when it shared
	 * the same distance range as actual content. */
	private addBackgroundDust(scene: THREE.Scene): void {
		const count = 3000;
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
			color: DUST_BACKGROUND_COLOR,
			size: 1.3,
			sizeAttenuation: false,
			transparent: true,
			opacity: 0.3,
			depthWrite: false,
			fog: false,
		});
		scene.add(new THREE.Points(geometry, material));
	}

	// --- Comets: a handful of streaks drifting through the outer dust field,
	// looping forever independent of the galaxy data so they survive rebuilds. ---

	private randomCometPoint(): THREE.Vector3 {
		const radius = 500 + Math.random() * 1000;
		const theta = Math.random() * Math.PI * 2;
		const phi = Math.acos(2 * Math.random() - 1);
		return new THREE.Vector3(
			radius * Math.sin(phi) * Math.cos(theta),
			radius * Math.sin(phi) * Math.sin(theta),
			radius * Math.cos(phi)
		);
	}

	private spawnComet(existing?: Comet): Comet {
		const start = this.randomCometPoint();
		const end = this.randomCometPoint();
		const duration = 7000 + Math.random() * 9000;

		if (existing) {
			existing.start.copy(start);
			existing.end.copy(end);
			existing.startTime = performance.now();
			existing.duration = duration;
			return existing;
		}

		const head = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: this.starTexture ?? undefined,
				color: 0xbfd8ff,
				transparent: true,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				opacity: 0.95,
			})
		);
		head.scale.set(5, 5, 1);

		const positions = new Float32Array(COMET_TRAIL_LENGTH * 3);
		const colors = new Float32Array(COMET_TRAIL_LENGTH * 3);
		const baseColor = new THREE.Color(0xbfd8ff);
		for (let i = 0; i < COMET_TRAIL_LENGTH; i++) {
			const fade = 1 - i / (COMET_TRAIL_LENGTH - 1);
			colors[i * 3] = baseColor.r * fade;
			colors[i * 3 + 1] = baseColor.g * fade;
			colors[i * 3 + 2] = baseColor.b * fade;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		const material = new THREE.LineBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: 0.7,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		const trail = new THREE.Line(geometry, material);

		this.cometsGroup?.add(head);
		this.cometsGroup?.add(trail);

		return { start, end, startTime: performance.now(), duration, head, trail };
	}

	private initComets(): void {
		if (!this.scene) return;
		const group = new THREE.Group();
		this.scene.add(group);
		this.cometsGroup = group;
		for (let i = 0; i < COMET_COUNT; i++) {
			const comet = this.spawnComet();
			comet.startTime -= Math.random() * comet.duration;
			this.comets.push(comet);
		}
	}

	private updateComets(time: number): void {
		const dir = new THREE.Vector3();
		const point = new THREE.Vector3();
		for (const comet of this.comets) {
			let t = (time - comet.startTime) / comet.duration;
			if (t >= 1) {
				this.spawnComet(comet);
				t = 0;
			}
			const pos = comet.start.clone().lerp(comet.end, t);
			comet.head.position.copy(pos);
			dir.copy(comet.end).sub(comet.start).normalize();

			const posAttr = comet.trail.geometry.getAttribute("position") as THREE.BufferAttribute;
			for (let i = 0; i < COMET_TRAIL_LENGTH; i++) {
				point.copy(pos).addScaledVector(dir, -i * COMET_TRAIL_SPACING);
				posAttr.setXYZ(i, point.x, point.y, point.z);
			}
			posAttr.needsUpdate = true;

			const fadeIn = Math.min(1, t / 0.06);
			const fadeOut = Math.min(1, (1 - t) / 0.06);
			const opacity = Math.min(fadeIn, fadeOut);
			comet.head.material.opacity = 0.95 * opacity;
			(comet.trail.material as THREE.LineBasicMaterial).opacity = 0.7 * opacity;
		}
	}

	private clearGalaxy(): void {
		if (!this.scene) return;
		const toRemove = this.scene.children.filter((c) => c.userData.isGalaxyContent);
		for (const obj of toRemove) {
			this.scene.remove(obj);
			const disposable = obj as THREE.Mesh | THREE.LineSegments | THREE.Points | THREE.Sprite;
			if (
				obj instanceof THREE.Mesh ||
				obj instanceof THREE.LineSegments ||
				obj instanceof THREE.Points ||
				obj instanceof THREE.Sprite
			) {
				disposable.geometry?.dispose();
				const mat = disposable.material;
				if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
				else mat.dispose();
			}
		}
		this.starLayers = [];
		this.starMaterials = [];
		this.starsByLayer = [];
		this.starIndex.clear();
		this.searchMatches.clear();
		this.stars = [];
		this.starLabels = [];
		this.tagLabels = [];
		this.groupsByStar.clear();
		this.quasarHalo = null;
		this.quasarJetMaterials = [];
		this.activeFlashes = [];
		this.nebulae = [];
		this.lineMaterial = null;
	}

	private populateScene(universes: UniverseGroup[]): void {
		if (!this.scene) return;
		this.currentUniverses = universes;
		const allStars: StarNode[] = [];
		for (const universe of universes) allStars.push(...universe.stars);
		this.stars = allStars;

		this.groupsByStar.clear();
		for (const universe of universes) {
			for (const group of universe.constellations) {
				for (const star of group.stars) {
					const list = this.groupsByStar.get(star.id) ?? [];
					list.push(group);
					this.groupsByStar.set(star.id, list);
				}
			}
		}

		this.weightSnapshot.clear();
		this.starPositionByPath.clear();
		for (const star of allStars) {
			this.weightSnapshot.set(star.id, star.weight);
			this.starPositionByPath.set(star.id, star.position);
		}

		this.addNebulae(universes);
		this.addStars(allStars);
		this.addConstellationLines(universes);
		this.addLabels(universes);
		this.renderGalaxyMenu();
	}

	private renderGalaxyMenu(): void {
		const menu = this.galaxyMenuEl;
		if (!menu) return;
		menu.empty();
		const sorted = [...this.currentUniverses].sort((a, b) => a.name.localeCompare(b.name));
		for (const universe of sorted) {
			const item = menu.createDiv({
				cls: "ct-dropdown-item",
				text: `${universe.name} · ${universe.stars.length}`,
			});
			item.onclick = (ev) => {
				ev.stopPropagation();
				this.flyToUniverse(universe);
				this.galaxyMenuOpen = false;
				menu.hide();
			};
		}
	}

	private addNebulae(universes: UniverseGroup[]): void {
		if (!this.scene || !this.glowTexture) return;
		for (const universe of universes) {
			if (universe.constellations.length === 0) continue;
			let sumSin = 0;
			let sumCos = 0;
			let totalWeight = 0;
			for (const group of universe.constellations) {
				const w = group.stars.length;
				const rad = (group.hue / 360) * Math.PI * 2;
				sumSin += Math.sin(rad) * w;
				sumCos += Math.cos(rad) * w;
				totalWeight += w;
			}
			if (totalWeight === 0) continue;
			const avgHue =
				((Math.atan2(sumSin / totalWeight, sumCos / totalWeight) / (Math.PI * 2)) * 360 +
					360) %
				360;
			const color = new THREE.Color().setHSL(avgHue / 360, 0.65, 0.5);
			const material = new THREE.SpriteMaterial({
				map: this.glowTexture,
				color,
				transparent: true,
				opacity: 0.1,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			});
			const sprite = new THREE.Sprite(material);
			sprite.position.copy(universe.center);
			const scale = universe.radius * 3.4;
			sprite.scale.set(scale, scale, 1);
			sprite.userData.isGalaxyContent = true;
			this.scene.add(sprite);
			this.nebulae.push({
				sprite,
				center: universe.center.clone(),
				radius: universe.radius,
				baseOpacity: 0.1,
			});
		}
	}

	/** Nebulae are meant to mark a universe from a distance, not wash out the
	 * stars once you've flown inside it — fade them out as the camera nears. */
	private updateNebulae(cameraPos: THREE.Vector3): void {
		for (const nebula of this.nebulae) {
			const distance = cameraPos.distanceTo(nebula.center);
			const nearR = nebula.radius * 1.4;
			const farR = nebula.radius * 4.5;
			const factor = THREE.MathUtils.clamp((distance - nearR) / (farR - nearR), 0, 1);
			nebula.sprite.material.opacity = nebula.baseOpacity * factor;
		}
	}

	private addStars(stars: StarNode[]): void {
		if (!this.scene || !this.starTexture || stars.length === 0) return;
		const weights = stars.map((s) => s.weight);
		const minWeight = Math.min(...weights);
		const maxWeight = Math.max(...weights);

		const tierSizes = [4, 6.5, 10];
		const buckets: {
			positions: number[];
			colors: number[];
			phases: number[];
			stars: StarNode[];
		}[] = [
			{ positions: [], colors: [], phases: [], stars: [] },
			{ positions: [], colors: [], phases: [], stars: [] },
			{ positions: [], colors: [], phases: [], stars: [] },
		];

		for (const star of stars) {
			const normW = starWeightNorm(star, minWeight, maxWeight);
			const tier = normW < 0.4 ? 0 : normW < 0.75 ? 1 : 2;
			const bucket = buckets[tier];
			bucket.positions.push(star.position.x, star.position.y, star.position.z);
			const color = starColor(star, minWeight, maxWeight);
			bucket.colors.push(color.r, color.g, color.b);
			bucket.phases.push(Math.random());
			bucket.stars.push(star);
		}

		buckets.forEach((bucket, tier) => {
			if (bucket.positions.length === 0) return;
			const tierSize = tierSizes[tier];
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute(
				"position",
				new THREE.Float32BufferAttribute(bucket.positions, 3)
			);
			geometry.setAttribute("color", new THREE.Float32BufferAttribute(bucket.colors, 3));
			geometry.setAttribute(
				"aPhase",
				new THREE.Float32BufferAttribute(bucket.phases, 1)
			);
			geometry.setAttribute(
				"aDim",
				new THREE.Float32BufferAttribute(new Array(bucket.stars.length).fill(1), 1)
			);
			const material = new THREE.ShaderMaterial({
				uniforms: {
					uTime: { value: 0 },
					uSize: { value: tierSize },
					uScale: { value: this.pointScale },
					uMaxSize: { value: 46 },
					uMap: { value: this.starTexture },
				},
				vertexShader: STAR_VERTEX_SHADER,
				fragmentShader: STAR_FRAGMENT_SHADER,
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			});
			const points = new THREE.Points(geometry, material);
			points.userData.isGalaxyContent = true;
			this.scene!.add(points);
			const layerIndex = this.starLayers.length;
			this.starLayers.push(points);
			this.starMaterials.push(material);
			this.starsByLayer.push(bucket.stars);
			bucket.stars.forEach((star, vertexIndex) => {
				this.starIndex.set(star.id, { layer: layerIndex, vertexIndex });
			});
		});

		this.addQuasar(stars, minWeight, maxWeight);
		this.applySearch(this.searchQuery);
	}

	/** The single heaviest-weighted note in the vault becomes a quasar: an
	 * always-visible beacon with a pulsating halo and two particle jets along
	 * a hue-hashed (so it's stable across rebuilds) axis. */
	private addQuasar(stars: StarNode[], minWeight: number, maxWeight: number): void {
		if (!this.scene || !this.starTexture || stars.length < 6 || maxWeight <= minWeight) return;
		let top = stars[0];
		for (const star of stars) if (star.weight > top.weight) top = star;

		const haloMaterial = new THREE.SpriteMaterial({
			map: this.starTexture,
			color: 0xdff1ff,
			transparent: true,
			opacity: 0.85,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		const halo = new THREE.Sprite(haloMaterial);
		halo.position.copy(top.position);
		this.quasarBaseScale = 11;
		halo.scale.setScalar(this.quasarBaseScale);
		halo.userData.isGalaxyContent = true;
		this.scene.add(halo);
		this.quasarHalo = halo;

		const seed = hashHue(top.id);
		const axis = new THREE.Vector3(
			Math.sin((seed / 360) * Math.PI * 2),
			Math.cos((seed / 137) * Math.PI * 2),
			Math.sin((seed / 71) * Math.PI * 2)
		).normalize();

		const arbitrary = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
		const perpU = new THREE.Vector3().crossVectors(axis, arbitrary).normalize();
		const perpV = new THREE.Vector3().crossVectors(axis, perpU).normalize();
		const jetColor = new THREE.Color(0xdff1ff);
		const particleCount = 70;

		for (const dir of [1, -1]) {
			const positions = new Float32Array(particleCount * 3);
			const phases = new Float32Array(particleCount);
			const angles = new Float32Array(particleCount);
			const radii = new Float32Array(particleCount);
			for (let i = 0; i < particleCount; i++) {
				phases[i] = Math.random();
				angles[i] = Math.random() * Math.PI * 2;
				radii[i] = 1 + Math.random() * 3.5;
			}
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
			geometry.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
			geometry.setAttribute("aRadius", new THREE.BufferAttribute(radii, 1));
			const material = new THREE.ShaderMaterial({
				uniforms: {
					uTime: { value: 0 },
					uLength: { value: 30 },
					uSpeed: { value: 0.45 },
					uOrigin: { value: top.position.clone() },
					uAxis: { value: axis.clone().multiplyScalar(dir) },
					uPerpU: { value: perpU },
					uPerpV: { value: perpV },
					uSize: { value: 3 },
					uScale: { value: this.pointScale },
					uMaxSize: { value: 30 },
					uMap: { value: this.glowTexture },
					uColor: { value: jetColor },
				},
				vertexShader: JET_VERTEX_SHADER,
				fragmentShader: JET_FRAGMENT_SHADER,
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			});
			const jet = new THREE.Points(geometry, material);
			jet.frustumCulled = false;
			jet.userData.isGalaxyContent = true;
			this.scene.add(jet);
			this.quasarJetMaterials.push(material);
		}
	}

	/** Three ways a universe can render its tag connections, assigned
	 * deterministically per universe in graphBuilder.ts so you get variety
	 * across the galaxy instead of one style everywhere. */
	private addConstellationLines(universes: UniverseGroup[]): void {
		this.addStreamConnections(universes);
		this.addFilamentConnections(universes);
		this.addConstellationClouds(universes);
	}

	/** "stream": the original look — a bright point runs along each
	 * constellation's path leaving a fading comet-tail, base line never
	 * fully off. Like debris trailing between colliding galaxies. */
	private addStreamConnections(universes: UniverseGroup[]): void {
		if (!this.scene) return;
		const positions: number[] = [];
		const colors: number[] = [];
		const progress: number[] = [];
		const phases: number[] = [];
		const lineColor = new THREE.Color();

		for (const universe of universes) {
			if (universe.connectionStyle !== "stream") continue;
			for (const group of universe.constellations) {
				if (group.ringStars.length < 2 || group.ringStars.length > MAX_CONSTELLATION_LINE_MEMBERS)
					continue;
				lineColor.setHSL(group.hue / 360, 0.7, 0.65);
				const groupPhase = Math.random();

				const cumulative = [0];
				for (let i = 1; i < group.ringStars.length; i++) {
					cumulative.push(
						cumulative[i - 1] + group.ringStars[i - 1].position.distanceTo(group.ringStars[i].position)
					);
				}
				const totalLength = cumulative[cumulative.length - 1] || 1;

				for (let i = 0; i < group.ringStars.length - 1; i++) {
					const a = group.ringStars[i].position;
					const b = group.ringStars[i + 1].position;
					positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
					colors.push(
						lineColor.r,
						lineColor.g,
						lineColor.b,
						lineColor.r,
						lineColor.g,
						lineColor.b
					);
					progress.push(cumulative[i] / totalLength, cumulative[i + 1] / totalLength);
					phases.push(groupPhase, groupPhase);
				}
			}
		}
		if (positions.length === 0) return;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(positions, 3)
		);
		geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
		geometry.setAttribute("aProgress", new THREE.Float32BufferAttribute(progress, 1));
		geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(phases, 1));
		const material = new THREE.ShaderMaterial({
			uniforms: {
				uTime: { value: 0 },
				uSpeed: { value: 0.055 },
			},
			vertexShader: LINE_VERTEX_SHADER,
			fragmentShader: LINE_FRAGMENT_SHADER,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		const lines = new THREE.LineSegments(geometry, material);
		lines.userData.isGalaxyContent = true;
		this.scene.add(lines);
		this.lineMaterial = material;
	}

	/** "filament": a dim, gently curved static gas strand through the ring —
	 * modeled on cosmic-web filaments bridging galaxies, not a crisp
	 * geometric connector. Real volume (a soft outer tube plus a brighter
	 * thin core), not a flat line — a flat line at this opacity read as a
	 * faint scribble, not a glowing strand. No animation; meant to read as
	 * background structure. */
	private addFilamentConnections(universes: UniverseGroup[]): void {
		if (!this.scene) return;
		for (const universe of universes) {
			if (universe.connectionStyle !== "filament") continue;
			for (const group of universe.constellations) {
				if (group.ringStars.length < 2 || group.ringStars.length > MAX_CONSTELLATION_LINE_MEMBERS)
					continue;
				const curve = new THREE.CatmullRomCurve3(
					group.ringStars.map((s) => s.position.clone())
				);
				const sampleCount = Math.max(16, group.ringStars.length * 8);
				const color = new THREE.Color().setHSL(group.hue / 360, 0.65, 0.6);

				const outerGeometry = new THREE.TubeGeometry(curve, sampleCount, 0.55, 6, false);
				const outerMaterial = new THREE.MeshBasicMaterial({
					color,
					transparent: true,
					opacity: 0.3,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
				});
				const outer = new THREE.Mesh(outerGeometry, outerMaterial);
				outer.userData.isGalaxyContent = true;
				this.scene.add(outer);

				const coreGeometry = new THREE.TubeGeometry(curve, sampleCount, 0.16, 5, false);
				const coreMaterial = new THREE.MeshBasicMaterial({
					color,
					transparent: true,
					opacity: 0.55,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
				});
				const core = new THREE.Mesh(coreGeometry, coreMaterial);
				core.userData.isGalaxyContent = true;
				this.scene.add(core);
			}
		}
	}

	/** "nebula": no per-pair connectors at all — the whole tag group shares
	 * one soft translucent cloud, like the reflection nebula wrapped around
	 * the Pleiades. Size follows how far the group's stars actually spread.
	 * Also the fallback for any oversized group in a stream/filament
	 * universe — those styles cap out at MAX_CONSTELLATION_LINE_MEMBERS and
	 * used to just skip bigger groups entirely, leaving bare rings of dots
	 * with no connector at all. Now they get a cloud instead, so every
	 * constellation renders as *something*. */
	private addConstellationClouds(universes: UniverseGroup[]): void {
		if (!this.scene || !this.glowTexture) return;
		for (const universe of universes) {
			for (const group of universe.constellations) {
				if (group.ringStars.length < 2) continue;
				const isOversizedForLines = group.ringStars.length > MAX_CONSTELLATION_LINE_MEMBERS;
				if (universe.connectionStyle !== "nebula" && !isOversizedForLines) continue;
				let spanRadius = 0;
				for (const star of group.ringStars) {
					spanRadius = Math.max(spanRadius, group.center.distanceTo(star.position));
				}
				if (spanRadius === 0) continue;
				const color = new THREE.Color().setHSL(group.hue / 360, 0.6, 0.55);
				const material = new THREE.SpriteMaterial({
					map: this.glowTexture,
					color,
					transparent: true,
					opacity: 0.16,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
				});
				const sprite = new THREE.Sprite(material);
				sprite.position.copy(group.center);
				// Capped defensively — layout.ts already bounds how far a huge
				// group's stars can spread, but this keeps a runaway spanRadius
				// from ever washing out the whole screen the way it used to.
				const scale = Math.min(spanRadius * 2.6, 130);
				sprite.scale.set(scale, scale, 1);
				sprite.userData.isGalaxyContent = true;
				this.scene.add(sprite);
			}
		}
	}

	private addLabels(universes: UniverseGroup[]): void {
		if (!this.scene) return;
		for (const universe of universes) {
			const anchor = universe.alphaStar?.position ?? universe.center;
			const el = activeDocument.createElement("div");
			el.className = "constellations-label constellations-label-universe";
			el.textContent = universe.name;
			el.title = `Перейти к вселенной «${universe.name}»`;
			el.addEventListener("click", (ev) => {
				ev.stopPropagation();
				this.flyToUniverse(universe);
			});
			const label = new CSS2DObject(el);
			label.position.set(anchor.x, anchor.y + 2.6, anchor.z);
			label.userData.isGalaxyContent = true;
			this.scene.add(label);

			for (const group of universe.constellations) {
				if (!group.alphaStar) continue;
				const tagAnchor = group.alphaStar.position;
				const tagEl = activeDocument.createElement("div");
				tagEl.className = "constellations-label constellations-label-tag";
				tagEl.textContent = `#${group.tag}`;
				tagEl.style.color = `hsl(${group.hue}, 78%, 74%)`;
				const tagLabel = new CSS2DObject(tagEl);
				tagLabel.position.set(tagAnchor.x, tagAnchor.y + 1.7, tagAnchor.z);
				tagLabel.userData.isGalaxyContent = true;
				tagLabel.visible = false;
				this.scene.add(tagLabel);
				this.tagLabels.push({ item: group, obj: tagLabel });
			}

			for (const star of universe.stars) {
				const nameEl = activeDocument.createElement("div");
				nameEl.className = "constellations-label constellations-label-star";
				nameEl.textContent = star.name;
				const nameLabel = new CSS2DObject(nameEl);
				nameLabel.position.set(
					star.position.x,
					star.position.y - 0.85,
					star.position.z
				);
				nameLabel.userData.isGalaxyContent = true;
				nameLabel.visible = false;
				this.scene.add(nameLabel);
				this.starLabels.push({ item: star, obj: nameLabel });
			}
		}
	}

	private updateLabelVisibility(): void {
		if (!this.camera) return;
		const camPos = this.camera.position;

		if (this.searchActive) {
			// While searching, names are the point — show every match's label
			// regardless of distance, hide the rest outright.
			for (const { item, obj } of this.starLabels) {
				obj.visible = this.searchMatches.has(item.id);
			}
		} else {
			// Only the nearest handful of star names show at once — inside a
			// dense cluster, showing every star within range piles hundreds of
			// labels on top of each other into unreadable text soup.
			const near: { obj: CSS2DObject; dist: number }[] = [];
			for (const { item, obj } of this.starLabels) {
				const dist = camPos.distanceTo(item.position);
				if (dist < STAR_LABEL_DISTANCE) {
					near.push({ obj, dist });
				} else {
					obj.visible = false;
				}
			}
			near.sort((a, b) => a.dist - b.dist);
			near.forEach(({ obj }, i) => {
				obj.visible = i < MAX_VISIBLE_STAR_LABELS;
			});
		}

		for (const { item, obj } of this.tagLabels) {
			const anchor = item.alphaStar?.position ?? item.center;
			obj.visible = camPos.distanceTo(anchor) < TAG_LABEL_DISTANCE;
		}
	}

	private handleResize(mount: HTMLElement): void {
		if (!this.camera || !this.renderer || !this.labelRenderer) return;
		const width = mount.clientWidth || 1;
		const height = mount.clientHeight || 1;
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height);
		this.composer?.setSize(width, height);
		this.bloomPass?.setSize(width, height);
		this.labelRenderer.setSize(width, height);
		this.pointScale = this.computePointScale();
		for (const material of this.starMaterials) material.uniforms.uScale.value = this.pointScale;
		for (const material of this.quasarJetMaterials) material.uniforms.uScale.value = this.pointScale;
	}

	private getPointerStar(ev: MouseEvent): StarNode | null {
		if (!this.renderer || !this.camera || this.starLayers.length === 0) return null;
		const rect = this.renderer.domElement.getBoundingClientRect();
		this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
		this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const hits = this.raycaster.intersectObjects(this.starLayers, false);
		if (hits.length === 0 || hits[0].index === undefined) return null;
		const layerIdx = this.starLayers.indexOf(hits[0].object as THREE.Points);
		if (layerIdx === -1) return null;
		return this.starsByLayer[layerIdx][hits[0].index] ?? null;
	}

	private handlePointerMove(ev: PointerEvent): void {
		if (!this.tooltipEl) return;
		const star = this.getPointerStar(ev);
		if (!star) {
			this.tooltipEl.hide();
			return;
		}
		this.tooltipEl.show();
		this.tooltipEl.setText(
			star.tags.length > 0 ? `${star.name}  ·  ${star.tags.map((t) => "#" + t).join(" ")}` : star.name
		);
		this.tooltipEl.style.left = `${ev.clientX + 14}px`;
		this.tooltipEl.style.top = `${ev.clientY + 14}px`;
	}

	private handleClick(ev: MouseEvent): void {
		const star = this.getPointerStar(ev);
		if (!star) return;
		this.flyTo(star.position);
		void this.showInfoPanel(star);
	}

	private flyTo(target: THREE.Vector3, distance = 9): void {
		if (!this.camera || !this.controls) return;
		const dir = this.camera.position.clone().sub(this.controls.target);
		if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
		dir.normalize();
		const toPos = target.clone().add(dir.multiplyScalar(distance));
		this.flyCameraTo(toPos, target.clone());
	}

	private flyToUniverse(universe: UniverseGroup): void {
		if (!this.camera || !this.controls) return;
		const dir = this.camera.position.clone().sub(this.controls.target);
		if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
		dir.normalize();
		// Close enough to already be "inside" the universe on arrival — a wide
		// establishing shot just means more manual zooming afterward.
		const distance = universe.radius * 1.5 + 6;
		const toPos = universe.center.clone().add(dir.multiplyScalar(distance));
		this.flyCameraTo(toPos, universe.center.clone());
	}

	/** Filters stars by name/tag substring match: matching stars stay at full
	 * brightness, everything else dims to near-invisible via the `aDim`
	 * vertex attribute — no geometry rebuild, just mutating the existing
	 * buffers, so it stays smooth while typing. */
	private applySearch(rawQuery: string): void {
		this.searchQuery = rawQuery;
		const query = rawQuery.trim().toLowerCase();
		this.searchActive = query.length > 0;
		this.searchMatches.clear();

		for (const star of this.stars) {
			const matches =
				!this.searchActive ||
				star.name.toLowerCase().includes(query) ||
				star.tags.some((t) => t.toLowerCase().includes(query));
			if (matches) this.searchMatches.add(star.id);

			const loc = this.starIndex.get(star.id);
			if (!loc) continue;
			const geometry = this.starLayers[loc.layer]?.geometry;
			const attr = geometry?.getAttribute("aDim") as THREE.BufferAttribute | undefined;
			attr?.setX(loc.vertexIndex, matches ? 1 : 0.08);
		}
		for (const layer of this.starLayers) {
			const attr = layer.geometry.getAttribute("aDim") as THREE.BufferAttribute | undefined;
			if (attr) attr.needsUpdate = true;
		}
	}

	private flyToFirstMatch(): void {
		if (!this.camera || this.searchMatches.size === 0) return;
		let best: StarNode | null = null;
		let bestDist = Infinity;
		for (const star of this.stars) {
			if (!this.searchMatches.has(star.id)) continue;
			const dist = this.camera.position.distanceTo(star.position);
			if (dist < bestDist) {
				bestDist = dist;
				best = star;
			}
		}
		if (!best) return;
		this.flyTo(best.position);
		void this.showInfoPanel(best);
	}

	private flyCameraTo(toPos: THREE.Vector3, toTarget: THREE.Vector3): void {
		if (!this.camera || !this.controls) return;
		this.clearIdleTimer();
		this.controls.autoRotate = false;
		this.flight = {
			start: performance.now(),
			duration: 950,
			fromPos: this.camera.position.clone(),
			toPos,
			fromTarget: this.controls.target.clone(),
			toTarget,
		};
	}

	private async showInfoPanel(star: StarNode): Promise<void> {
		const panel = this.infoPanelEl;
		if (!panel) return;
		panel.empty();
		panel.show();
		panel.style.setProperty("--accent-hue", String(star.hue));

		const header = panel.createDiv({ cls: "ci-header" });
		const title = header.createEl("a", { text: star.name, cls: "ci-title" });
		title.href = "#";
		title.onclick = (e) => {
			e.preventDefault();
			void this.plugin.app.workspace.getLeaf(false).openFile(star.file);
		};
		const closeBtn = header.createEl("button", { cls: "ci-close", text: "×" });
		closeBtn.onclick = () => panel.hide();
		panel.createDiv({ cls: "ci-path", text: star.file.path });

		const groups = this.groupsByStar.get(star.id) ?? [];
		if (groups.length > 0) {
			const tagsRow = panel.createDiv({ cls: "ci-tags" });
			for (const group of groups) {
				const chip = tagsRow.createSpan({ cls: "ci-chip", text: `#${group.tag}` });
				chip.style.setProperty("--chip-hue", String(group.hue));
			}
		}

		const previewEl = panel.createDiv({ cls: "ci-preview", text: "Загрузка…" });
		try {
			const content = await this.plugin.app.vault.cachedRead(star.file);
			const plain = content
				.replace(/```[\s\S]*?```/g, " ")
				.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
				.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
				.replace(/[#>*_`~-]/g, " ")
				.replace(/\s+/g, " ")
				.trim();
			previewEl.setText(plain.length > 260 ? plain.slice(0, 260) + "…" : plain || "Пусто.");
		} catch {
			previewEl.setText("Не удалось прочитать содержимое.");
		}

		if (groups.length > 0) {
			panel.createDiv({ cls: "ci-neighbors-title", text: "Соседние звёзды" });
			const list = panel.createDiv({ cls: "ci-neighbors" });
			const seen = new Set([star.id]);
			outer: for (const group of groups) {
				for (const neighbor of group.stars) {
					if (seen.has(neighbor.id)) continue;
					seen.add(neighbor.id);
					const item = list.createDiv({ cls: "ci-neighbor", text: neighbor.name });
					item.onclick = () => {
						this.flyTo(neighbor.position);
						void this.showInfoPanel(neighbor);
					};
					if (list.childNodes.length >= 14) break outer;
				}
			}
		}
	}

	private triggerFlash(
		position: THREE.Vector3,
		opts: { size: number; color: number; duration: number }
	): void {
		if (!this.scene || !this.starTexture) return;
		const material = new THREE.SpriteMaterial({
			map: this.starTexture,
			color: opts.color,
			transparent: true,
			opacity: 1,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		const sprite = new THREE.Sprite(material);
		sprite.position.copy(position);
		sprite.scale.setScalar(0.6);
		sprite.userData.isGalaxyContent = true;
		this.scene.add(sprite);
		this.activeFlashes.push({
			sprite,
			start: performance.now(),
			duration: opts.duration,
			maxScale: opts.size,
		});
	}

	private updateFlashes(time: number): void {
		if (this.activeFlashes.length === 0 || !this.scene) return;
		for (let i = this.activeFlashes.length - 1; i >= 0; i--) {
			const flash = this.activeFlashes[i];
			const t = (time - flash.start) / flash.duration;
			if (t >= 1) {
				this.scene.remove(flash.sprite);
				(flash.sprite.material as THREE.Material).dispose();
				this.activeFlashes.splice(i, 1);
				continue;
			}
			const eased = 1 - Math.pow(1 - t, 3);
			flash.sprite.scale.setScalar(0.6 + eased * flash.maxScale);
			flash.sprite.material.opacity = 1 - t;
		}
	}

	/** New markdown file anywhere in the vault: debounce a rebuild (cheap even
	 * for large vaults, see computeStarWeight), then flash every star id that
	 * wasn't there before — usually just the one that was just created. */
	private handleFileCreated(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
		const prevIds = new Set(this.stars.map((s) => s.id));
		this.rebuildTimer = window.setTimeout(() => {
			this.rebuildTimer = null;
			this.rebuild();
			for (const star of this.stars) {
				if (!prevIds.has(star.id)) {
					this.triggerFlash(star.position, { size: 9, color: 0xffffff, duration: 1500 });
				}
			}
		}, 700);
	}

	/** Editing a note doesn't need a full rebuild — just recompute that one
	 * file's weight (single cheap pass over resolvedLinks) and, if it jumped
	 * noticeably, flash it in place as a "supernova" without touching layout. */
	private handleFileChanged(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		const path = file.path;
		const existing = this.changeDebounceTimers.get(path);
		if (existing !== undefined) window.clearTimeout(existing);
		const timer = window.setTimeout(() => {
			this.changeDebounceTimers.delete(path);
			this.evaluateGrowth(file);
		}, 900);
		this.changeDebounceTimers.set(path, timer);
	}

	private evaluateGrowth(file: TFile): void {
		const position = this.starPositionByPath.get(file.path);
		const prev = this.weightSnapshot.get(file.path);
		if (!position || prev === undefined) return;

		const backlinkCounts = computeBacklinkCounts(this.plugin.app);
		const weight = computeStarWeight(this.plugin.app, file, backlinkCounts);
		if (weight - prev >= 2) {
			this.triggerFlash(position, { size: 14, color: 0xffd27a, duration: 1800 });
		}
		this.weightSnapshot.set(file.path, weight);
	}

	private scheduleIdleAutoRotate(): void {
		this.clearIdleTimer();
		this.idleTimer = window.setTimeout(() => {
			if (this.controls) this.controls.autoRotate = true;
		}, IDLE_ROTATE_DELAY);
	}

	private clearIdleTimer(): void {
		if (this.idleTimer !== null) {
			window.clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		if (this.controls) this.controls.autoRotate = false;
	}

	private animate = (now?: number): void => {
		this.animationHandle = window.requestAnimationFrame(this.animate);
		const time = now ?? performance.now();

		if (this.flight && this.camera && this.controls) {
			const t = Math.min(1, (time - this.flight.start) / this.flight.duration);
			const eased = easeInOutCubic(t);
			this.camera.position.lerpVectors(this.flight.fromPos, this.flight.toPos, eased);
			this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, eased);
			if (t >= 1) {
				this.flight = null;
				this.scheduleIdleAutoRotate();
			}
		}

		for (const material of this.starMaterials) material.uniforms.uTime.value = time / 1000;
		for (const material of this.quasarJetMaterials) material.uniforms.uTime.value = time / 1000;
		if (this.lineMaterial) this.lineMaterial.uniforms.uTime.value = time / 1000;
		this.updateComets(time);
		this.updateFlashes(time);

		if (this.quasarHalo) {
			const pulse = 0.85 + 0.15 * Math.sin((time / 1000) * 1.2);
			this.quasarHalo.scale.setScalar(this.quasarBaseScale * pulse);
			this.quasarHalo.material.opacity = 0.75 * pulse + 0.1;
		}

		this.controls?.update();
		if (this.camera) this.updateNebulae(this.camera.position);
		this.updateLabelVisibility();
		if (this.scene && this.camera) {
			if (this.composer) this.composer.render();
			else this.renderer?.render(this.scene, this.camera);
			this.labelRenderer?.render(this.scene, this.camera);
		}
	};
}
