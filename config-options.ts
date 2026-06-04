import type {
	ContextDisplayMode,
	ContextUnknownMode,
	GitShaMode,
	GlanceConfig,
	IconMode,
	ModelThinkingMode,
	TokensCacheMode,
	TokensDisplayMode,
	WorkspaceLabelMode,
} from "./types.js";

export const ICON_MODE_VALUES: ReadonlyArray<IconMode> = ["plain", "nerd"];
export const PROVIDER_DISPLAY_MODE_VALUES: ReadonlyArray<GlanceConfig["display"]["showProvider"]> = ["auto", "always", "never"];
export const WORKSPACE_LABEL_MODE_VALUES: ReadonlyArray<WorkspaceLabelMode> = ["name", "smart", "path"];
export const GIT_SHA_MODE_VALUES: ReadonlyArray<GitShaMode> = ["off", "detached", "always"];
export const CONTEXT_DISPLAY_MODE_VALUES: ReadonlyArray<ContextDisplayMode> = ["percent+tokens", "percent", "tokens"];
export const CONTEXT_UNKNOWN_MODE_VALUES: ReadonlyArray<ContextUnknownMode> = ["show", "hide"];
export const TOKENS_DISPLAY_MODE_VALUES: ReadonlyArray<TokensDisplayMode> = ["input-output", "total"];
export const TOKENS_CACHE_MODE_VALUES: ReadonlyArray<TokensCacheMode> = ["auto", "show", "hide"];
export const MODEL_THINKING_MODE_VALUES: ReadonlyArray<ModelThinkingMode> = ["auto", "always", "never"];
