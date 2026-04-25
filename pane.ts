import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { cloneConfig, defaultConfig, moveSegment, toggleSegment } from "./config.js";
import { renderInputSurface, renderInputSurfacePreview } from "./renderer.js";
import { SEGMENT_BY_ID } from "./segments.js";
import type { GlanceConfig, GlanceState, GlanceThemeName, IconMode } from "./types.js";

type PaneFocus = "global" | "segments";
type PaneResult = { action: "save"; config: GlanceConfig } | { action: "cancel" };

type Done = (result: PaneResult) => void;

function nextIn<T extends string>(current: T, values: readonly T[]): T {
	const index = values.indexOf(current);
	return values[(index + 1) % values.length] ?? values[0]!;
}

function plainLine(parts: string[], width: number): string {
	return truncateToWidth(parts.join(""), width, "…");
}

function padRightAnsi(text: string, width: number): string {
	const extra = Math.max(0, width - visibleWidth(text));
	return `${text}${" ".repeat(extra)}`;
}

export class GlanceConfigPane implements Component {
	private draft: GlanceConfig;
	private focus: PaneFocus = "global";
	private globalIndex = 0;
	private segmentIndex = 0;
	private status = "Edit settings, then Save or Cancel.";

	constructor(
		initial: GlanceConfig,
		private readonly theme: Theme,
		private readonly done: Done,
		private readonly requestRender: () => void,
		private readonly previewState?: GlanceState,
	) {
		this.draft = cloneConfig(initial);
	}

	invalidate(): void {}

	private globalItems(): Array<{ id: string; label: string; value: string }> {
		return [
			{ id: "enabled", label: "Enabled", value: this.draft.enabled ? "on" : "off" },
			{ id: "theme", label: "Theme", value: this.draft.theme },
			{ id: "icons", label: "Icons", value: this.draft.icons },
			{ id: "rows", label: "Min Rows", value: `${this.draft.editor.minContentRows}` },
			{ id: "provider", label: "Provider", value: this.draft.display.showProvider },
		];
	}

	private mutateGlobal(): void {
		const item = this.globalItems()[this.globalIndex];
		if (!item) return;
		switch (item.id) {
			case "enabled":
				this.draft.enabled = !this.draft.enabled;
				break;
			case "theme":
				this.draft.theme = nextIn(this.draft.theme, ["light", "dark"] as GlanceThemeName[]);
				break;
			case "icons":
				this.draft.icons = nextIn(this.draft.icons, ["nerd", "plain"] as IconMode[]);
				break;
			case "rows": {
				const rows = [2, 3, 4] as const;
				const index = rows.indexOf(this.draft.editor.minContentRows as 2 | 3 | 4);
				this.draft.editor.minContentRows = rows[(index + 1) % rows.length] ?? 4;
				break;
			}
			case "provider":
				this.draft.display.showProvider = nextIn(this.draft.display.showProvider, ["auto", "always", "never"] as const);
				break;
		}
		this.status = `${item.label} changed. Press S to save.`;
	}

	private toggleCurrentSegment(): void {
		const segment = this.draft.segments[this.segmentIndex];
		if (!segment) return;
		this.draft = toggleSegment(this.draft, segment.id);
		this.status = `${SEGMENT_BY_ID.get(segment.id)?.label ?? segment.id} toggled. Press S to save.`;
	}

	private moveCurrentSegment(direction: -1 | 1): void {
		const segment = this.draft.segments[this.segmentIndex];
		if (!segment) return;
		this.draft = moveSegment(this.draft, segment.id, direction);
		this.segmentIndex = Math.max(0, Math.min(this.draft.segments.length - 1, this.segmentIndex + direction));
		this.status = "Segment order changed. Press S to save.";
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
			this.done({ action: "cancel" });
			return;
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			this.done({ action: "cancel" });
			return;
		}
		if (data === "s" || data === "S") {
			this.done({ action: "save", config: cloneConfig(this.draft) });
			return;
		}
		if (data === "r" || data === "R") {
			this.draft = defaultConfig();
			this.globalIndex = 0;
			this.segmentIndex = 0;
			this.status = "Reset to defaults. Press S to save or Esc to cancel.";
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.focus = this.focus === "global" ? "segments" : "global";
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.up)) {
			if (this.focus === "global") this.globalIndex = Math.max(0, this.globalIndex - 1);
			else this.segmentIndex = Math.max(0, this.segmentIndex - 1);
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			if (this.focus === "global") this.globalIndex = Math.min(this.globalItems().length - 1, this.globalIndex + 1);
			else this.segmentIndex = Math.min(this.draft.segments.length - 1, this.segmentIndex + 1);
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
			if (this.focus === "global") this.mutateGlobal();
			else this.toggleCurrentSegment();
			this.requestRender();
			return;
		}
		if (this.focus === "segments" && (data === "k" || data === "K")) {
			this.moveCurrentSegment(-1);
			this.requestRender();
			return;
		}
		if (this.focus === "segments" && (data === "j" || data === "J")) {
			this.moveCurrentSegment(1);
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const t = this.theme;
		const accent = (s: string) => t.fg("accent", s);
		const muted = (s: string) => t.fg("muted", s);
		const dim = (s: string) => t.fg("dim", s);
		const warn = (s: string) => t.fg("warning", s);
		const success = (s: string) => t.fg("success", s);
		const title = accent(t.bold("pi-glance")) + dim("  input surface configuration") + dim("  fixed: project title · rounded · top-right · labels off");
		const border = new DynamicBorder((s: string) => t.fg("accent", s)).render(width)[0] ?? "";
		const lines: string[] = [border, plainLine(["  ", title], width), ""];

		const preview = this.previewState
			? renderInputSurface(this.previewState, this.draft, Math.max(24, width - 4), {
					contentLines: ["Ask pi to improve the input surface..."],
					focused: true,
				})
			: renderInputSurfacePreview(this.draft, Math.max(24, width - 4), {
					contentLines: ["Ask pi to improve the input surface..."],
					focused: true,
				});
		lines.push(plainLine(["  ", accent("Preview")], width));
		for (const previewLine of preview) {
			lines.push(plainLine(["  ", previewLine], width));
		}
		lines.push("");

		const colGap = 3;
		const leftWidth = Math.max(24, Math.floor((width - colGap) * 0.42));
		const rightWidth = Math.max(24, width - leftWidth - colGap);
		const globalItems = this.globalItems();
		const rows = Math.max(globalItems.length, this.draft.segments.length);
		const globalHeader = this.focus === "global" ? accent(t.bold("Global Settings")) : muted("Global Settings");
		const segmentHeader = this.focus === "segments" ? accent(t.bold("Status Segments")) : muted("Status Segments");
		lines.push(plainLine(["  ", padRightAnsi(globalHeader, leftWidth), " ".repeat(colGap), segmentHeader], width));

		for (let i = 0; i < rows; i++) {
			const global = globalItems[i];
			let left = "";
			if (global) {
				const selected = this.focus === "global" && i === this.globalIndex;
				const cursor = selected ? accent("▶ ") : "  ";
				const value = selected ? accent(global.value) : muted(global.value);
				left = `${cursor}${global.label}: ${value}`;
			}

			const segment = this.draft.segments[i];
			let right = "";
			if (segment) {
				const selected = this.focus === "segments" && i === this.segmentIndex;
				const cursor = selected ? accent("▶ ") : "  ";
				const marker = segment.enabled ? success("●") : dim("○");
				const definition = SEGMENT_BY_ID.get(segment.id);
				const label = definition?.label ?? segment.id;
				right = `${cursor}${marker} ${label}`;
			}
			lines.push(plainLine(["  ", padRightAnsi(left, leftWidth), " ".repeat(colGap), truncateToWidth(right, rightWidth, "…")], width));
		}

		lines.push("");
		lines.push(
			plainLine(
				[
					"  ",
					dim("Tab switch • ↑↓ navigate • Enter/Space toggle • J/K move segment • S save • R reset • Esc/Q cancel"),
				],
				width,
			),
		);
		lines.push(plainLine(["  ", this.status.includes("save") ? warn(this.status) : muted(this.status)], width));
		lines.push(border);
		return lines;
	}
}

export interface GlancePaneUI {
	custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: unknown, done: (result: T) => void) => Component,
	): Promise<T>;
}

export async function showGlancePane(initial: GlanceConfig, ctx: { ui: GlancePaneUI }, previewState?: GlanceState): Promise<PaneResult> {
	return ctx.ui.custom<PaneResult>((tui, theme, _kb, done) => {
		return new GlanceConfigPane(initial, theme, done, () => tui.requestRender(), previewState);
	});
}
