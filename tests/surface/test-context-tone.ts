import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { renderGlanceLine } from "../../src/surface/status-line.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { GLANCE_THEME_IDS } from "../../src/theme/themes.js";
import { testState } from "../support/helpers.js";

for (const display of ["tokens", "percent", "percent+tokens"] as const) {
	test(`Context ${display} alerts use public percentage independently of text and density`, () => {
		for (const theme of GLANCE_THEME_IDS) {
			for (const colorMode of ["truecolor", "ansi256"] as const) {
				const styles = resolveBuiltInGlanceStyles(theme, colorMode);
				for (const [percent, tone] of [[74.6, "normal"], [75, "warning"], [89.6, "warning"], [90, "error"], [null, "normal"]] as const) {
					const config = defaultConfig();
					config.context.display = display;
					config.segments = [{ id: "context", enabled: true }];
					const state = testState({ context: { tokens: 180_000, window: 200_000, percent } });
					for (const widthMode of ["full", "compact", "minimal"] as const) {
						const output = renderGlanceLine(state, config, 120, 1, { styles, widthMode });
						const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
						const style = tone === "error" ? styles.error : tone === "warning" ? styles.warn : styles.segments.context.fg;
						assert.equal(output, `${style(plain)}\x1b[0m`, `${theme}/${colorMode}/${percent}/${widthMode}`);
					}
				}
			}
		}
	});
}
