import type { GlanceConfig, SegmentDefinition } from "../types.js";

export interface SettingOption {
	label: string;
	hint?: string;
}

/** Choices are explicit so the pane can show a list or step in either direction. */
export interface SegmentSettingDescriptor {
	id: string;
	label: string;
	hint: string;
	kind: "toggle" | "choice";
	options: readonly SettingOption[];
	value(config: GlanceConfig): string;
	selectedIndex(config: GlanceConfig): number;
	select(config: GlanceConfig, index: number): void;
}

export function choiceSetting<T extends string | number | boolean>(
	id: string, label: string, hint: string,
	options: readonly (SettingOption & { value: T })[],
	read: (config: GlanceConfig) => T,
	write: (config: GlanceConfig, value: T) => void,
	format: (value: T) => string = String,
): SegmentSettingDescriptor {
	return {
		id, label, hint, kind: "choice", options,
		value: config => options.find(option => option.value === read(config))?.label ?? format(read(config)),
		selectedIndex: config => options.findIndex(option => option.value === read(config)),
		select: (config, index) => {
			const option = options[index];
			if (option) write(config, option.value);
		},
	};
}

export function toggleSetting(
	id: string, label: string, hint: string,
	read: (config: GlanceConfig) => boolean,
	write: (config: GlanceConfig, value: boolean) => void,
): SegmentSettingDescriptor {
	return { ...choiceSetting(id, label, hint, [{ value: true, label: "On" }, { value: false, label: "Off" }], read, write), kind: "toggle" };
}

export type SegmentFeature = SegmentDefinition & {
	defaultEnabled: boolean;
	settings: readonly SegmentSettingDescriptor[];
};
