import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CURSOR_MARKER, truncateToWidth } from "@earendil-works/pi-tui";
import { truncateStyledText } from "../../src/surface/text.js";

test("fast styled clipping preserves Pi's bytes, markers and overflow behavior", () => {
	for (const text of ["", "ASCII", "中文 🧑‍💻 café", `\x1b[38;2;12;34;56m中文 ${CURSOR_MARKER}prompt\x1b[39m`,
		"\x1b[1mA\x1b[22m\x1b[48;5;17mbackground\x1b[49m", "\x1b]8;;https://example.com\x07link\x1b]8;;\x07", "a\tb"]) {
		for (const width of [0, 1, 2, 3, 4, 8, 16, 100]) {
			for (const ellipsis of ["", "…", "\x1b[2m…\x1b[22m"]) {
				assert.equal(truncateStyledText(text, width, ellipsis), truncateToWidth(text, width, ellipsis), `${JSON.stringify(text)} at ${width}`);
			}
		}
	}
});
