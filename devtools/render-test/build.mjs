import esbuild from "esbuild";

await esbuild.build({
	entryPoints: ["devtools/render-test/render.ts"],
	bundle: true,
	format: "iife",
	target: "es2020",
	outfile: "devtools/render-test/bundle.js",
	logLevel: "info",
});
