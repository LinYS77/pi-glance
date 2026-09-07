import { strict as assert } from "node:assert";
import { test } from "node:test";
import { paneHarness, keys as k } from "../support/pane-harness.js";
import { stripAnsi } from "../support/surface-test-harness.js";

function frame(lines: string[]): string[] {
	const first = lines.findIndex(line => stripAnsi(line).trimStart().startsWith("╭"));
	const last = lines.findIndex(line => stripAnsi(line).trimStart().startsWith("╰"));
	assert.ok(first >= 0 && last > first);
	return lines.slice(first, last + 1);
}

test("Working section previews mode and speed without touching the caller config", () => {
	const h = paneHarness();
	assert.equal(h.pending(), 0);
	h.press(k.backTab);
	assert.equal(h.pending(), 1);
	const first = frame(h.pane.render(100));
	h.advance(900);
	assert.notDeepEqual(frame(h.pane.render(100)), first);
	h.press(k.down);
	const before = frame(h.pane.render(100));
	h.press(k.right);
	assert.match(h.text(), /48 cols\/s/);
	assert.deepEqual(frame(h.pane.render(100)), before, "speed change preserves the beam position");
	assert.equal(h.pending(), 1);
	h.advance(900);
	assert.notDeepEqual(frame(h.pane.render(100)), before);
	h.press("s");
	const saved = h.completion();
	if (saved?.action !== "save") throw new Error("not saved");
	assert.equal(saved.config.editor.workingSweepSpeed, 48);
	assert.equal(h.config.editor.workingSweepSpeed, 47);
	assert.equal(h.pending(), 0);
	h.pane.dispose();
});

test("animation off keeps the speed, stops preview, and re-enables a single clock", () => {
	const h = paneHarness();
	h.press(k.backTab, k.right, k.right); // perimeter -> top -> off
	assert.equal(h.pending(), 0);
	h.press(k.down, k.right);
	assert.match(h.text(), /48 cols\/s/);
	assert.match(h.text(), /Turn animation on/);
	assert.equal(h.pending(), 0);
	h.press(k.up, k.left);
	assert.equal(h.pending(), 1);
	const stale = h.stale();
	h.press(k.tab);
	assert.equal(h.pending(), 0);
	const renders = h.renders();
	stale(); h.advance(1000);
	assert.equal(h.renders(), renders);
	h.pane.dispose();
});

test("closing a preview invalidates pending callbacks and further input", () => {
	const h = paneHarness(); h.press(k.backTab);
	const stale = h.stale();
	h.pane.dispose();
	const renders = h.renders();
	stale(); h.advance(1000); h.press(k.down);
	assert.equal(h.renders(), renders);
	assert.equal(h.pending(), 0);
});
