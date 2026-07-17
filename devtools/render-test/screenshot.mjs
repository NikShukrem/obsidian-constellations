import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || __dirname;

// Headless software-rendered WebGL sporadically loses context for a frame
// or two (self-heals) — a screenshot taken during that window comes out
// as a near-blank ~7KB PNG. Retry until it's clearly a real render.
const BLANK_THRESHOLD_BYTES = 20000;

async function shootWithRetry(page, filePath, attempts = 5) {
	for (let i = 0; i < attempts; i++) {
		await page.screenshot({ path: filePath });
		if (fs.statSync(filePath).size > BLANK_THRESHOLD_BYTES) return true;
		await page.waitForTimeout(400);
	}
	console.warn(`  still blank after ${attempts} attempts: ${filePath}`);
	return false;
}

const browser = await chromium.launch({
	args: [
		"--use-gl=swiftshader",
		"--use-angle=swiftshader",
		"--disable-gpu-sandbox",
		"--enable-webgl",
		"--ignore-gpu-blacklist",
	],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (err) => console.error("[pageerror]", err.message));

await page.goto("file://" + path.join(__dirname, "index.html"));
await page.waitForFunction("window.__ready === true", { timeout: 15000 });
await page.waitForTimeout(500);

const universeNames = await page.evaluate(() => window.__universes.map((u) => u.name));

await page.evaluate(() => window.__frameAll());
await page.waitForTimeout(300);
await shootWithRetry(page, path.join(outDir, "overview.png"));

for (const name of universeNames) {
	await page.evaluate((n) => window.__frameUniverse(n), name);
	await page.waitForTimeout(300);
	await shootWithRetry(page, path.join(outDir, `universe-${name}.png`));
}

// Near/far shots of individual groups so the cloud<->thread crossfade
// (cloud visible far away, threads visible up close) can be verified
// visually instead of just trusting the interpolation math.
const groupShots = [
	{ universe: "ShapeDemo", tag: "tag0" },
	{ universe: "ShapeDemo", tag: "tag1" },
	{ universe: "ShapeDemo", tag: "tag2" },
];
for (const { universe, tag } of groupShots) {
	await page.evaluate(({ universe, tag }) => window.__frameGroup(universe, tag, 3.5), { universe, tag });
	await page.waitForTimeout(300);
	await shootWithRetry(page, path.join(outDir, `group-${universe}-${tag}-far.png`));

	await page.evaluate(({ universe, tag }) => window.__frameGroup(universe, tag, 0.85), { universe, tag });
	await page.waitForTimeout(300);
	await shootWithRetry(page, path.join(outDir, `group-${universe}-${tag}-near.png`));
}

await browser.close();
console.log(
	"Done:",
	[
		"overview.png",
		...universeNames.map((n) => `universe-${n}.png`),
		...groupShots.flatMap(({ universe, tag }) => [`group-${universe}-${tag}-far.png`, `group-${universe}-${tag}-near.png`]),
	].join(", ")
);
