import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { GlanceConfig, GlanceThemeName, IconMode, SegmentConfig, SegmentId } from "./types.js";

export const CONFIG_PATH = join(getAgentDir(), "pi-glance", "config.json");
export const CONFIG_VERSION = 2 as const;

export const DEFAULT_SEGMENTS: SegmentConfig[] = [
	{ id: "git.branch", enabled: true, priority: 65 },
	{ id: "model", enabled: true, priority: 100 },
	{ id: "context", enabled: true, priority: 95 },
	{ id: "tokens", enabled: true, priority: 55 },
	{ id: "cost", enabled: false, priority: 35 },
];

const SEGMENT_IDS = new Set<SegmentId>(DEFAULT_SEGMENTS.map((s) => s.id));
const THEMES = new Set<GlanceThemeName>(["light", "dark"]);
const ICON_MODES = new Set<IconMode>(["nerd", "plain"]);
const PROVIDER_MODES = new Set<GlanceConfig["display"]["showProvider"]>(["auto", "always", "never"]);

export function defaultConfig(): GlanceConfig {
	return {
		version: CONFIG_VERSION,
		enabled: true,
		theme: "light",
		icons: "nerd",
		editor: {
			minContentRows: 4,
		},
		display: {
			adaptive: true,
			showProvider: "auto",
		},
		segments: DEFAULT_SEGMENTS.map((s) => ({ ...s })),
		model: {
			customNames: {},
		},
	};
}

export function cloneConfig(config: GlanceConfig): GlanceConfig {
	return {
		...config,
		editor: { ...config.editor },
		display: { ...config.display },
		segments: config.segments.map((s) => ({ ...s })),
		model: { customNames: { ...config.model.customNames } },
	};
}

function parseBool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function parseStringEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
	return typeof value === "string" && allowed.has(value as T) ? (value as T) : fallback;
}

function parseIntInRange(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseFiniteNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeSegments(value: unknown): SegmentConfig[] {
	const defaults = DEFAULT_SEGMENTS.map((s) => ({ ...s }));
	const byId = new Map<SegmentId, SegmentConfig>(defaults.map((s) => [s.id, s]));
	const ordered: SegmentConfig[] = [];

	if (Array.isArray(value)) {
		for (const raw of value) {
			if (!raw || typeof raw !== "object") continue;
			const record = raw as Record<string, unknown>;
			if (typeof record.id !== "string" || !SEGMENT_IDS.has(record.id as SegmentId)) continue;
			const id = record.id as SegmentId;
			const base = byId.get(id)!;
			const segment = {
				id,
				enabled: parseBool(record.enabled, base.enabled),
				priority: parseFiniteNumber(record.priority, base.priority),
			};
			byId.set(id, segment);
			if (!ordered.some((s) => s.id === id)) ordered.push(segment);
		}
	}

	for (const segment of defaults) {
		if (!ordered.some((s) => s.id === segment.id)) ordered.push(byId.get(segment.id)!);
	}

	return ordered;
}

export function normalizeConfig(raw: unknown): GlanceConfig {
	const defaults = defaultConfig();
	if (!raw || typeof raw !== "object") return defaults;
	const record = raw as Record<string, unknown>;
	const editor = record.editor && typeof record.editor === "object" ? (record.editor as Record<string, unknown>) : {};
	const display = record.display && typeof record.display === "object" ? (record.display as Record<string, unknown>) : {};
	const model = record.model && typeof record.model === "object" ? (record.model as Record<string, unknown>) : {};

	return {
		version: CONFIG_VERSION,
		enabled: parseBool(record.enabled, defaults.enabled),
		theme: parseStringEnum(record.theme, THEMES, defaults.theme),
		icons: parseStringEnum(record.icons, ICON_MODES, defaults.icons),
		editor: {
			minContentRows: parseIntInRange(editor.minContentRows, defaults.editor.minContentRows, 2, 4),
		},
		display: {
			adaptive: parseBool(display.adaptive, defaults.display.adaptive),
			showProvider: parseStringEnum(display.showProvider, PROVIDER_MODES, defaults.display.showProvider),
		},
		segments: normalizeSegments(record.segments),
		model: {
			customNames:
				model.customNames && typeof model.customNames === "object"
					? (Object.fromEntries(
							Object.entries(model.customNames as Record<string, unknown>).filter(
								(entry): entry is [string, string] => typeof entry[1] === "string",
							),
						) as Record<string, string>)
					: {},
		},
	};
}

export async function loadConfig(): Promise<GlanceConfig> {
	try {
		const text = await readFile(CONFIG_PATH, "utf8");
		return normalizeConfig(JSON.parse(text));
	} catch {
		return defaultConfig();
	}
}

export async function saveConfig(config: GlanceConfig): Promise<void> {
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify(normalizeConfig(config), null, "\t")}\n`, "utf8");
}

export function moveSegment(config: GlanceConfig, id: SegmentId, direction: -1 | 1): GlanceConfig {
	const next = cloneConfig(config);
	const index = next.segments.findIndex((s) => s.id === id);
	if (index < 0) return next;
	const target = index + direction;
	if (target < 0 || target >= next.segments.length) return next;
	[next.segments[index], next.segments[target]] = [next.segments[target]!, next.segments[index]!];
	return next;
}

export function toggleSegment(config: GlanceConfig, id: SegmentId): GlanceConfig {
	const next = cloneConfig(config);
	const segment = next.segments.find((s) => s.id === id);
	if (segment) segment.enabled = !segment.enabled;
	return next;
}
