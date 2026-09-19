import { contextSegmentFeature } from "./context.js";
import { costSegmentFeature } from "./cost.js";
import { gitSegmentFeature } from "./git.js";
import { modelSegmentFeature } from "./model.js";
import { throughputSegmentFeature } from "./throughput.js";
import { tokensSegmentFeature } from "./tokens.js";
import type { SegmentFeature } from "./feature.js";
import type { SettingDescriptor } from "../config/settings.js";
import type { SegmentConfig, SegmentId } from "../types.js";

export { type SegmentId } from "../types.js";

export const SEGMENT_IDS = ["git", "cost", "throughput", "context", "tokens", "extensions", "model"] as const satisfies readonly SegmentId[];

export type SegmentRegistryEntry = SegmentFeature | {
	id: "extensions";
	label: string;
	defaultEnabled: boolean;
	settings: readonly SettingDescriptor[];
};

export const SEGMENT_REGISTRY = [
	gitSegmentFeature,
	costSegmentFeature,
	throughputSegmentFeature,
	contextSegmentFeature,
	tokensSegmentFeature,
	{ id: "extensions", label: "Extensions", defaultEnabled: true, settings: [] },
	modelSegmentFeature,
] as const satisfies readonly SegmentRegistryEntry[];

export const SEGMENT_BY_ID: ReadonlyMap<SegmentId, SegmentRegistryEntry> = new Map(
	SEGMENT_REGISTRY.map((segment) => [segment.id, segment]),
);

const SEGMENT_ID_SET: ReadonlySet<string> = new Set(SEGMENT_IDS);

export function defaultSegmentConfigs(): SegmentConfig[] {
	return SEGMENT_REGISTRY.map((segment) => ({ id: segment.id, enabled: segment.defaultEnabled }));
}

export function isSegmentId(value: unknown): value is SegmentId {
	return typeof value === "string" && SEGMENT_ID_SET.has(value);
}

export function segmentLabel(id: SegmentId): string {
	return SEGMENT_BY_ID.get(id)?.label ?? id;
}

export function getSegmentSettings(id: SegmentId): readonly SettingDescriptor[] {
	return SEGMENT_BY_ID.get(id)?.settings ?? [];
}
