import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { PromptStash } from "../../src/input/stash.js";
import { createDraftStore } from "../../src/input/store.js";

test("a first-turn draft survives store recreation, stays session-local and is removed on restore", () => {
	const dir = mkdtempSync(join(tmpdir(), "glance-drafts-"));
	try {
		const store = createDraftStore(dir);
		const stash = new PromptStash(store.loadDraft("one"), text => store.saveDraft("one", text));
		const original = "  中文\n" + "🐾 long paste\n".repeat(200);
		assert.equal(stash.exchange(original), "");
		assert.equal(createDraftStore(dir).loadDraft("one"), original);
		assert.equal(store.loadDraft("two"), null);
		if (process.platform !== "win32") assert.equal(statSync(join(dir, "one.json")).mode & 0o777, 0o600);
		const resumed = new PromptStash(store.loadDraft("one"), text => store.saveDraft("one", text));
		assert.equal(resumed.exchange(""), original);
		assert.deepEqual(readdirSync(dir), []);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("invalid draft files are not overwritten and save failure leaves the in-memory stash intact", () => {
	const dir = mkdtempSync(join(tmpdir(), "glance-drafts-fail-"));
	try {
		const store = createDraftStore(dir);
		writeFileSync(join(dir, "invalid.json"), "{");
		assert.throws(() => store.loadDraft("invalid"));
		assert.equal(readFileSync(join(dir, "invalid.json"), "utf8"), "{");
		store.saveDraft("one", "A");
		let fail = true;
		const stash = new PromptStash("A", text => { if (fail) throw new Error("disk full"); store.saveDraft("one", text); });
		assert.throws(() => stash.exchange("B"), /disk full/);
		assert.equal(stash.hasDraft, true);
		assert.equal(store.loadDraft("one"), "A");
		fail = false;
		assert.equal(stash.exchange("B"), "A");
		assert.equal(store.loadDraft("one"), "B");
		mkdirSync(join(dir, "blocked.json"));
		assert.throws(() => store.saveDraft("blocked", "text"));
		assert.ok(!readdirSync(dir).some(name => name.endsWith(".tmp")));
		assert.throws(() => store.loadDraft("../escape"));
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
