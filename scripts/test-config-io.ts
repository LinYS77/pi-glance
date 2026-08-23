import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GlanceConfig } from "../types.js";

type ConfigLoadStatus = "loaded" | "missing" | "invalid" | "unreadable" | "future";

interface ConfigLoadResult {
	config: GlanceConfig;
	status: ConfigLoadStatus;
	writable: boolean;
	diagnostic?: string;
}

interface ConfigModule {
	defaultConfig(): GlanceConfig;
	normalizeConfig(raw: unknown): GlanceConfig;
	configFromText(text: string): GlanceConfig;
	configToText(config: GlanceConfig): string;
	loadConfigSync(): ConfigLoadResult;
	loadConfig(): Promise<ConfigLoadResult>;
	saveConfig(config: GlanceConfig): Promise<void>;
}

async function writeConfigText(configPath: string, text: string): Promise<void> {
	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(configPath, text, "utf8");
}

function assertLoadResult(
	actual: ConfigLoadResult,
	expected: { config: GlanceConfig; status: ConfigLoadStatus; writable: boolean; diagnostic?: RegExp },
	message: string,
): void {
	assert.deepEqual(actual.config, expected.config, `${message}: config`);
	assert.equal(actual.status, expected.status, `${message}: status`);
	assert.equal(actual.writable, expected.writable, `${message}: writable`);
	if (expected.diagnostic) assert.match(actual.diagnostic ?? "", expected.diagnostic, `${message}: diagnostic`);
	else assert.equal(actual.diagnostic, undefined, `${message}: diagnostic should stay absent`);
}

async function main(): Promise<void> {
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = await mkdtemp(join(tmpdir(), "pi-glance-config-io-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;

	try {
		// CONFIG_PATH is computed when config.js is imported, so set the isolated
		// agent dir before this dynamic import to avoid touching real user config.
		const configModule = (await import(`../config.js?config-io=${process.pid}-${Date.now()}`)) as ConfigModule;
		const { configFromText, configToText, defaultConfig, loadConfig, loadConfigSync, normalizeConfig, saveConfig } = configModule;
		const configDir = join(agentDir, "pi-glance");
		const configPath = join(configDir, "config.json");

		assertLoadResult(loadConfigSync(), { config: defaultConfig(), status: "missing", writable: true }, "missing sync config should use writable defaults");
		assertLoadResult(await loadConfig(), { config: defaultConfig(), status: "missing", writable: true }, "missing async config should use writable defaults");

		await writeConfigText(configPath, "{");
		assertLoadResult(
			loadConfigSync(),
			{ config: defaultConfig(), status: "invalid", writable: false, diagnostic: /invalid.*using defaults.*blocking saves/i },
			"invalid JSON sync load should be diagnosed",
		);
		assertLoadResult(
			await loadConfig(),
			{ config: defaultConfig(), status: "invalid", writable: false, diagnostic: /invalid.*using defaults.*blocking saves/i },
			"invalid JSON async load should be diagnosed",
		);

		await writeConfigText(configPath, "false");
		assertLoadResult(
			loadConfigSync(),
			{ config: defaultConfig(), status: "invalid", writable: false, diagnostic: /must be a JSON object.*blocking saves/i },
			"non-object config should be diagnosed instead of silently accepted",
		);

		const partialRaw = { enabled: false, icons: "nerd" };
		const partialExpected = normalizeConfig(partialRaw);
		await writeConfigText(configPath, JSON.stringify(partialRaw));
		assert.deepEqual(configFromText(await readFile(configPath, "utf8")), partialExpected, "configFromText should parse and normalize valid partial config file text");
		assertLoadResult(loadConfigSync(), { config: partialExpected, status: "loaded", writable: true }, "sync load should normalize valid partial config text");
		assertLoadResult(await loadConfig(), { config: partialExpected, status: "loaded", writable: true }, "async load should normalize valid partial config text");

		const futureRaw = { version: 9, enabled: false, icons: "nerd", futureOnly: { preserve: true } };
		await writeConfigText(configPath, JSON.stringify(futureRaw));
		const futureExpected = normalizeConfig(futureRaw);
		assertLoadResult(
			loadConfigSync(),
			{ config: futureExpected, status: "future", writable: false, diagnostic: /version 9.*newer than supported version 8.*without overwriting/i },
			"future sync config should load known fields read-only",
		);
		assertLoadResult(
			await loadConfig(),
			{ config: futureExpected, status: "future", writable: false, diagnostic: /version 9.*newer than supported version 8.*without overwriting/i },
			"future async config should load known fields read-only",
		);

		await rm(configDir, { recursive: true, force: true });
		await writeFile(configDir, "not a directory", "utf8");
		assertLoadResult(
			loadConfigSync(),
			{ config: defaultConfig(), status: "unreadable", writable: false, diagnostic: /could not be read.*blocking saves/i },
			"sync filesystem failures should be diagnosed",
		);
		assertLoadResult(
			await loadConfig(),
			{ config: defaultConfig(), status: "unreadable", writable: false, diagnostic: /could not be read.*blocking saves/i },
			"async filesystem failures should be diagnosed",
		);
		await rm(configDir, { force: true });

		const nextConfig = normalizeConfig({
			enabled: false,
			theme: { light: "one-light", dark: "tokyo-night" },
			icons: "nerd",
			display: { adaptive: false, workspaceLabel: "path", showProvider: "always" },
			git: { shaMode: "always", pollIntervalMs: 30000 },
			tokens: { display: "total", cache: "rate" },
		});
		await saveConfig(nextConfig);
		const savedText = await readFile(configPath, "utf8");
		assert.equal(savedText, configToText(nextConfig), "saveConfig should atomically install configToText output exactly");
		assert.deepEqual(JSON.parse(savedText).theme, { light: "one-light", dark: "tokyo-night" }, "saveConfig should serialize the current theme pair shape");
		assert.equal(JSON.parse(savedText).tokens.cache, "rate", "saveConfig should serialize the cache-rate mode");
		assert.equal("adaptive" in JSON.parse(savedText).display, false, "saveConfig should drop the legacy adaptive width setting because fitting is always on");
		assert.deepEqual(configFromText(savedText), normalizeConfig(nextConfig), "configFromText should round-trip saveConfig output");
		assertLoadResult(loadConfigSync(), { config: normalizeConfig(nextConfig), status: "loaded", writable: true }, "sync load should round-trip atomically saved config");
		assertLoadResult(await loadConfig(), { config: normalizeConfig(nextConfig), status: "loaded", writable: true }, "async load should round-trip atomically saved config");
		assert.deepEqual(await readdir(configDir), ["config.json"], "successful atomic save should leave no temporary files");

		await writeConfigText(configPath, "{");
		const validConfig = normalizeConfig({ enabled: true, theme: "tokyo-night", context: { display: "tokens", unknown: "hide" } });
		await saveConfig(validConfig);
		assert.equal(await readFile(configPath, "utf8"), configToText(validConfig), "saveConfig should support explicit recovery by replacing invalid config atomically");
		assertLoadResult(loadConfigSync(), { config: normalizeConfig(validConfig), status: "loaded", writable: true }, "sync load should read recovered valid config");
		assertLoadResult(await loadConfig(), { config: normalizeConfig(validConfig), status: "loaded", writable: true }, "async load should read recovered valid config");

		await rm(configPath, { force: true });
		await mkdir(configPath);
		await assert.rejects(() => saveConfig(validConfig), "rename failure should reject atomic save");
		assert.deepEqual(await readdir(configDir), ["config.json"], "failed atomic save should clean up its temporary file");
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(agentDir, { recursive: true, force: true });
	}
}

await main();
console.log("✓ config IO diagnostics and atomic-save checks passed");
