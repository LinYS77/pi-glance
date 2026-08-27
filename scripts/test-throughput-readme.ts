import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

const readme = await readFile("README.md", "utf8");
const chineseReadme = await readFile("README.zh-CN.md", "utf8");

assert.ok(readme.includes("Model speed"), "the English README should keep the user-facing Model speed label");
assert.ok(chineseReadme.includes("模型速度"), "the Chinese README should keep the translated Model speed label");
assert.ok(!/\bthroughput\b/i.test(readme), "the README should not revive the old user-facing Throughput name");

console.log("✓ bilingual Model speed copy checks passed");
