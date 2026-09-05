import { THROUGHPUT_PRECISION_DESCRIPTOR } from "./config-schema.js";
import type {
	ContextDisplayMode,
	ContextUnknownMode,
	GitShaMode,
	EditorTopMarginRows,
	GlanceConfig,
	IconMode,
	ModelThinkingMode,
	ThroughputPrecision,
	TokensCacheMode,
	TokensDisplayMode,
	WorkspaceLabelMode,
} from "./types.js";

export const ICON_MODE_VALUES: ReadonlyArray<IconMode> = ["plain", "nerd"];
export const PROVIDER_DISPLAY_MODE_VALUES: ReadonlyArray<GlanceConfig["display"]["showProvider"]> = ["auto", "always", "never"];
export const WORKSPACE_LABEL_MODE_VALUES: ReadonlyArray<WorkspaceLabelMode> = ["name", "smart", "path"];
export const EDITOR_TOP_MARGIN_ROW_VALUES: ReadonlyArray<EditorTopMarginRows> = [0, 1, 2];
export const GIT_SHA_MODE_VALUES: ReadonlyArray<GitShaMode> = ["off", "detached", "always"];
export const CONTEXT_DISPLAY_MODE_VALUES: ReadonlyArray<ContextDisplayMode> = ["percent+tokens", "percent", "tokens"];
export const CONTEXT_UNKNOWN_MODE_VALUES: ReadonlyArray<ContextUnknownMode> = ["show", "hide"];
export const TOKENS_DISPLAY_MODE_VALUES: ReadonlyArray<TokensDisplayMode> = ["input-output", "total"];
export const TOKENS_CACHE_MODE_VALUES: ReadonlyArray<TokensCacheMode> = ["rate", "read-write", "hide"];
export const MODEL_THINKING_MODE_VALUES: ReadonlyArray<ModelThinkingMode> = ["auto", "always", "never"];
export const THROUGHPUT_PRECISION_VALUES: ReadonlyArray<ThroughputPrecision> = THROUGHPUT_PRECISION_DESCRIPTOR.values;

/** Cycle a curated option list; an unrecognized current value starts at the first option. */
export function nextOption<T extends string | number>(current: string | number, values: readonly T[]): T {
	const first = values[0];
	if (first === undefined) throw new Error("Cannot cycle an empty option list");
	const index = values.findIndex((value) => value === current);
	return values[index + 1] ?? first;
}
