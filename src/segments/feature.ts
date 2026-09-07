import type { SettingDescriptor } from "../config/settings.js";
import type { SegmentDefinition } from "../types.js";

export type SegmentFeature = SegmentDefinition & {
	defaultEnabled: boolean;
	settings: readonly SettingDescriptor[];
};
