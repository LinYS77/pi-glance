import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fg, fg256, foregroundStyle } from "../../src/theme/palette.js";

for (const mode of ["truecolor", "ansi256"] as const) {
	test(`${mode} foreground encoding is done once per style`, () => {
		let reads = 0;
		const color = { get r() { reads++; return 31; }, get g() { reads++; return 159; }, get b() { reads++; return 198; } };
		const style = foregroundStyle(color, mode);
		const baseline = reads;
		assert.ok(baseline > 0);
		for (const text of ["", "text", "─".repeat(100), "中文", "\x1b[1mStyled\x1b[22m"]) {
			assert.equal(style(text), (mode === "truecolor" ? fg : fg256)({ r: 31, g: 159, b: 198 }, text));
		}
		assert.equal(reads, baseline, "rendering does not repeat color conversion");
	});
}
