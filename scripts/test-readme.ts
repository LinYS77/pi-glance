import { strict as assert } from "node:assert";
import { access, readFile } from "node:fs/promises";
import { GLANCE_THEMES } from "../themes.js";

const readme = await readFile("README.md", "utf8");
const chineseReadme = await readFile("README.zh-CN.md", "utf8");
const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
	description?: string;
	files?: string[];
	pi?: {
		extensions?: string[];
		image?: string;
		video?: string;
	};
};

const INPUT_SURFACE_IMAGE = "https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/input-surface.png";
const SETTINGS_IMAGE = "https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/settings.png";
const THEMES_GIF = "https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/themes.gif";

function assertIncludes(document: string, fragment: string, message: string): void {
	assert.ok(document.includes(fragment), message);
}

assert.ok(readme.length < 4_000, "the English README should remain a concise product page");
assert.ok(chineseReadme.length < 4_000, "the Chinese README should remain a concise product page");

assertIncludes(readme, "A calm input surface", "the English README should lead with the product position");
assertIncludes(readme, "README.zh-CN.md", "the English README should link to Simplified Chinese");
assertIncludes(chineseReadme, "一个简洁、安静的", "the Chinese README should lead with the translated product position");
assertIncludes(chineseReadme, "README.md", "the Chinese README should link back to English");

for (const document of [readme, chineseReadme]) {
	assertIncludes(document, "pi -e npm:pi-glance", "both READMEs should offer a one-session trial");
	assertIncludes(document, "pi install npm:pi-glance", "both READMEs should document installation");
	assertIncludes(document, "pi update npm:pi-glance", "both READMEs should document updates");
	assertIncludes(document, "/glance", "both READMEs should name the only settings command");
	assertIncludes(document, INPUT_SURFACE_IMAGE, "both READMEs should show the input surface");
	assertIncludes(document, SETTINGS_IMAGE, "both READMEs should show the settings pane");
	assertIncludes(document, THEMES_GIF, "both READMEs should embed the animated theme preview");
	assert.ok(!document.includes(".mp4"), "the READMEs should not reference the retired MP4 preview");
	assert.ok(!document.includes("assets/demo.gif"), "the retired demo GIF must not return");
	assert.ok(!document.includes("github.com/badlogic/pi-mono"), "README links should use the current Pi repository");
}

assert.equal(GLANCE_THEMES.length, 22, "the curated theme collection should remain complete");
assertIncludes(readme, "22 palettes", "the English README should state the palette count");
assertIncludes(chineseReadme, "22 套配色", "the Chinese README should state the palette count");
assertIncludes(readme, "Git · Cost · Model speed · Context · Tokens · Model", "the English README should name the adaptive facts");
assertIncludes(chineseReadme, "Git · 费用 · 模型速度 · 上下文 · Tokens · 模型", "the Chinese README should name the adaptive facts");
assertIncludes(readme, "no telemetry", "the English README should state the privacy boundary");
assertIncludes(chineseReadme, "不收集遥测数据", "the Chinese README should state the privacy boundary");
assertIncludes(readme, "Pi 0.84.4", "the English README should state the tested Pi baseline");
assertIncludes(chineseReadme, "Pi 0.84.4", "the Chinese README should state the tested Pi baseline");
assertIncludes(readme, "Node.js 22.19.0 or newer", "the English README should state the Node floor");
assertIncludes(chineseReadme, "Node.js 22.19.0 或更高版本", "the Chinese README should state the Node floor");

for (const implementationDetail of ["cacheRead /", "agent_settled", "sessionManager.getBranch", "theme: { light:"]) {
	assert.ok(!readme.includes(implementationDetail), `the product README should leave ${implementationDetail} to architecture docs`);
}

assert.equal(manifest.description, "A calm input surface for Pi with a rounded multiline editor and adaptive status glance.");
assert.ok(manifest.files?.includes("README*.md"), "the npm package should include both language READMEs");
assert.deepEqual(manifest.pi?.extensions, ["./index.ts"], "the Pi extension entry should remain unchanged");
assert.equal(manifest.pi?.image, THEMES_GIF, "the Pi package gallery should use the animated GIF preview");
assert.equal(manifest.pi?.video, undefined, "the Pi package manifest should not retain an MP4 preview");

await Promise.all([access("assets/input-surface.png"), access("assets/settings.png"), access("assets/themes.gif")]);
const themesGif = await readFile("assets/themes.gif");
assert.equal(themesGif.subarray(0, 6).toString("ascii"), "GIF89a", "the theme preview should be a GIF89a animation");
assert.ok(themesGif.byteLength < 5_000_000, "the animated theme preview should remain suitable for a README");

console.log("✓ concise bilingual README and gallery metadata checks passed");
