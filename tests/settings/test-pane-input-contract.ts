import { strict as assert } from "node:assert";
import { test } from "node:test";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { paneHarness, keys as k } from "../support/pane-harness.js";

test("letter commands accept Kitty encoding just like native navigation", () => {
	const h = paneHarness();
	try {
		h.press(k.tab, "\x1b[100u");
		assert.match(h.text(), /Preview · Full/);
		h.press(k.tab, "\x1b[112u");
		assert.match(h.text(), /Compacting/);
		h.press("\x1b[115u");
		assert.equal(h.completion()?.action, "save");
	} finally { h.pane.dispose(); }
});

test("help advertises a working save binding when Pi selection owns S", () => {
	const h = paneHarness(defaultConfig(), {}, new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.down": ["s"] }));
	try {
		assert.doesNotMatch(h.text(), /\[S\] Save & close/);
		assert.match(h.text(), /\[Ctrl\+S\] Save & close/);
		h.press("s");
		assert.equal(h.completion(), undefined);
		assert.match(h.text(), /› Light palette/);
		h.press("\x13");
		assert.equal(h.completion()?.action, "save");
	} finally { h.pane.dispose(); }
});

test("narrow panes expose complete contextual help without losing the selected row or draft", () => {
	for (const [path, expected] of [[ [k.tab], /Preview layout/ ], [ [k.tab, k.tab], /Preview state/ ]] as const) {
		const h = paneHarness();
		try {
			h.press(...path, k.down, k.right);
			const selected = h.text(100).split("\n").find(line => line.startsWith("› "));
			assert.match(h.text(40), /\[\?\] Help/);
			h.press("?");
			assert.match(h.text(40), /Keyboard help/);
			let help = h.text(40);
			for (let i = 0; i < 15; i++) { h.press(k.down); help += h.text(40); }
			assert.match(help, expected);
			assert.match(help, /Ctrl\+C/);
			h.press(k.esc);
			assert.equal(h.text(100).split("\n").find(line => line.startsWith("› ")), selected);
			assert.equal(h.completion(), undefined);
		} finally { h.pane.dispose(); }
	}
});

test("paste is never a list command, including fragmented data and an Enter after the paste", () => {
	const h = paneHarness();
	try {
		h.press("\x1b[200~", "s", "r", "q", "\x03", "\x1b[201~");
		assert.equal(h.completion(), undefined);
		assert.match(h.text(), /No changes/);
		assert.doesNotMatch(h.text(), /Reset all settings/);
		h.press(k.down, "\x1b[200~ignored\x1b[201~\r");
		assert.match(h.text(), /Light palette/, "a real key following the paste still reaches the picker");
		assert.match(h.text(), /Confirm/);
	} finally { h.pane.dispose(); }
});
