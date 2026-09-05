import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_VERSION, configToText, defaultConfig, normalizeConfig } from "./model.js";
import type { GlanceConfig } from "../types.js";

export type ConfigLoadStatus = "loaded" | "missing" | "invalid" | "unreadable" | "future";

export interface ConfigLoadResult {
	config: GlanceConfig;
	status: ConfigLoadStatus;
	writable: boolean;
	diagnostic?: string;
}

/** One file, with no import-time environment or shared store state. */
export function createConfigStore(configPath: string) {
	function errorMessage(error: unknown): string {
		return error instanceof Error && error.message ? error.message : String(error);
	}

	function isMissingConfigError(error: unknown): boolean {
		return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
	}

	function configLoadResultFromText(text: string): ConfigLoadResult {
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch (error) {
			return {
				config: defaultConfig(),
				status: "invalid",
				writable: false,
				diagnostic: `pi-glance configuration is invalid; using defaults and blocking saves until ${configPath} is fixed or removed (${errorMessage(error)})`,
			};
		}

		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return {
				config: defaultConfig(),
				status: "invalid",
				writable: false,
				diagnostic: `pi-glance configuration must be a JSON object; using defaults and blocking saves until ${configPath} is fixed or removed`,
			};
		}

		const rawVersion = (raw as Record<string, unknown>).version;
		if (typeof rawVersion === "number" && Number.isFinite(rawVersion) && rawVersion > CONFIG_VERSION) {
			return {
				config: normalizeConfig(raw),
				status: "future",
				writable: false,
				diagnostic: `pi-glance configuration version ${rawVersion} is newer than supported version ${CONFIG_VERSION}; using known fields without overwriting the file`,
			};
		}

		return { config: normalizeConfig(raw), status: "loaded", writable: true };
	}

	function configReadErrorResult(error: unknown): ConfigLoadResult {
		if (isMissingConfigError(error)) return { config: defaultConfig(), status: "missing", writable: true };
		return {
			config: defaultConfig(),
			status: "unreadable",
			writable: false,
			diagnostic: `pi-glance configuration could not be read; using defaults and blocking saves until ${configPath} is accessible (${errorMessage(error)})`,
		};
	}

	function loadConfigSync(): ConfigLoadResult {
		try {
			return configLoadResultFromText(readFileSync(configPath, "utf8"));
		} catch (error) {
			return configReadErrorResult(error);
		}
	}

	async function loadConfig(): Promise<ConfigLoadResult> {
		try {
			return configLoadResultFromText(await readFile(configPath, "utf8"));
		} catch (error) {
			return configReadErrorResult(error);
		}
	}

	async function saveConfig(config: GlanceConfig): Promise<void> {
		const configDir = dirname(configPath);
		const temporaryPath = join(configDir, `.config.json.${process.pid}.${randomUUID()}.tmp`);
		await mkdir(configDir, { recursive: true });
		try {
			await writeFile(temporaryPath, configToText(config), { encoding: "utf8", flag: "wx", mode: 0o600 });
			await rename(temporaryPath, configPath);
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
			throw error;
		}
	}

	return { loadConfigSync, loadConfig, saveConfig };
}
