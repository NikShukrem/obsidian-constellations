import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["node_modules/**", "main.js", "esbuild.config.mjs", "version-bump.mjs"],
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		plugins: {
			"@typescript-eslint": tseslint.plugin,
		},
		rules: {
			"@typescript-eslint/no-unnecessary-type-assertion": "warn",
			"@typescript-eslint/no-floating-promises": "warn",
		},
	}
);
