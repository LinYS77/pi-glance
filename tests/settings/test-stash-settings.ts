import { strict as assert } from "node:assert";
import { test } from "node:test";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { paneHarness, keys as k } from "../support/pane-harness.js";

function capture() {
	const kb = new KeybindingsManager(TUI_KEYBINDINGS);
	const h = paneHarness(defaultConfig(), {}, Object.assign(kb, { getEffectiveConfig: () => ({ "app.editor.external": "ctrl+g" as const, "tui.input.tab": "tab" as const }) }));
	h.press(k.backTab, k.down, k.down, k.down, k.enter);
	return h;
}

test("Input records a shortcut, rejects Pi conflicts, and saves only after confirming", () => {
	const h = capture();
	assert.match(h.text(), /Stash shortcut/);
	h.press("\x07");
	assert.match(h.text(), /Used by Pi/);
	h.press(k.enter);
	assert.match(h.text(), /Used by Pi/);
	h.press("\x1bx");
	assert.match(h.text(), /alt\+x/);
	h.press(k.enter, "s");
	const result = h.completion();
	assert.equal(result?.action, "save");
	if (result?.action === "save") assert.equal(result.config.editor.stashShortcut, "alt+x");
	h.pane.dispose();
});

test("Esc cancels shortcut edits and ordinary letters cannot save while recording", () => {
	const h = capture();
	h.press("s");
	assert.equal(h.completion(), undefined);
	h.press("\x1bx", k.esc, "s");
	const result = h.completion();
	if (result?.action !== "save") throw new Error("not saved");
	assert.equal(result.config.editor.stashShortcut, "alt+s");
	h.pane.dispose();
});
