import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PromptStash } from "../../src/input/stash.js";

test("one shortcut stashes, restores and exchanges without losing either draft", () => {
	const saved: Array<string | null> = [];
	const stash = new PromptStash(null, value => saved.push(value));
	assert.equal(stash.exchange(""), "");
	assert.deepEqual(saved, []);
	assert.equal(stash.exchange("original\n🐾"), "");
	assert.equal(stash.hasDraft, true);
	assert.equal(stash.exchange("temporary"), "original\n🐾");
	assert.equal(stash.exchange(""), "temporary");
	assert.equal(stash.hasDraft, false);
	assert.deepEqual(saved, ["original\n🐾", "temporary", null]);
});
