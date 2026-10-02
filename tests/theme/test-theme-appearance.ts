import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readPiAmbientTone } from "../../src/theme/tone.js";
import { resolveGlanceRenderStyles } from "../../src/theme/adapter.js";

test("public appearance selects the configured slot and follows changes without a theme-name change", () => {
	const host = { theme: { name: "system", appearance: "dark" } };
	const context = { getAmbientTone: () => readPiAmbientTone(host) };
	const palettes = { light: "one-light", dark: "tokyo-night" } as const;
	assert.equal(resolveGlanceRenderStyles(palettes, context).cacheKey, "glance:tokyo-night:truecolor");
	host.theme.appearance = "light";
	assert.equal(resolveGlanceRenderStyles(palettes, context).cacheKey, "glance:one-light:truecolor");
	for (const name of ["custom", "light", "dark"]) {
		host.theme = { name, appearance: "dark" };
		assert.equal(readPiAmbientTone(host), "dark", "appearance takes precedence over names");
	}
	for (const appearance of [undefined, null, "DARK", "invalid"]) {
		const legacy = { theme: { name: "dark", appearance } };
		assert.equal(readPiAmbientTone(legacy), "dark");
		legacy.theme.name = "custom";
		assert.equal(readPiAmbientTone(legacy), "unknown");
	}
});
