import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

const readme = await readFile("README.md", "utf8");

assert.ok(readme.includes("Model speed"), "README should document the user-facing Model speed segment");
assert.ok(readme.includes("enabled by default"), "README should state Model speed is enabled by default");
assert.ok(/\?/.test(readme), "README should document the Model speed unknown ? placeholder");
assert.ok(/~/.test(readme), "README should document the Model speed provisional ~ marker");
assert.ok(/Precision/i.test(readme), "README should document the Model speed Precision setting");
assert.ok(/no notifications/i.test(readme), "README should state Model speed sends no notifications");
assert.ok(/no timer/i.test(readme) || /no timers/i.test(readme), "README should state Model speed uses no timers");
assert.ok(/no token estimation/i.test(readme) || /does not estimate tokens/i.test(readme), "README should state Model speed does no token estimation");
assert.ok(/provider-reported `?output`? tokens/i.test(readme) || /provider-reported output tokens/i.test(readme), "README should define Model speed from provider-reported output tokens");
assert.ok(/active assistant streaming/i.test(readme) || /active model-stream/i.test(readme), "README should define Model speed using active assistant streaming time");
assert.ok(/tool execution/i.test(readme) && /first stream event/i.test(readme), "README should clarify Model speed excludes tool execution and pre-stream waiting");
assert.ok(/reasoning tokens/i.test(readme), "README should clarify whether provider-reported reasoning tokens are included");

console.log("✓ throughput README copy checks passed");
