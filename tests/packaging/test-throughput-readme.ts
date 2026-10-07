import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

const readme = await readFile("README.md", "utf8");
const chineseReadme = await readFile("README.zh-CN.md", "utf8");

assert.ok(readme.includes("Model speed"), "the English README should keep the user-facing Model speed label");
assert.ok(chineseReadme.includes("模型速度"), "the Chinese README should keep the translated Model speed label");
assert.ok(readme.includes("effective output throughput"), "name the effective metric without renaming the Model speed segment");
assert.ok(readme.includes("not raw decode speed"), "distinguish full-request throughput from decode speed");
assert.ok(readme.includes("including thinking time changes the metric"), "explain the reasoning numerator/time semantic change");
assert.ok(chineseReadme.includes("有效输出吞吐率"), "name the effective metric in Chinese");
assert.ok(chineseReadme.includes("不是原始解码速度"), "distinguish the metric from raw decode speed in Chinese");
assert.ok(chineseReadme.includes("扣除推理 tokens 却保留思考时间"), "explain the reasoning semantic change in Chinese");
for (const document of [readme, chineseReadme]) {
	assert.ok(document.includes("avg tok/s"), "both READMEs should document the explicit average label");
	assert.ok(document.includes("`~`"), "both READMEs should explain the provisional marker");
}

console.log("✓ bilingual Model speed copy checks passed");
