import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { cloneConfig, defaultConfig, moveSegment, toggleSegment } from "./config.js";
import { renderInputSurface, renderInputSurfacePreview } from "./renderer.js";
import { SEGMENT_BY_ID } from "./segments.js";
import type { GlanceConfig, GlanceState, GlanceThemeName, IconMode } from "./types.js";

type PaneFocus = "global" | "segments";
type PaneResult = { action: "save"; config: GlanceConfig } | { action: "cancel" };
type Done = (result: PaneResult) => void;
type GlobalItem = { id: string; label: string; value: string };

type Tone = (text: string) => string;
interface PaneColors {
	accent: Tone;
	muted: Tone;
	dim: Tone;
	warn: Tone;
	success: Tone;
}

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

function spreadAnsi(left: string, right: string, width: number): string {
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	if (leftWidth + rightWidth + 1 > width) {
		const leftBudget = Math.max(0, width - rightWidth - 1);
		if (leftBudget <= 0) return truncateToWidth(right, width, "…");
		return `${truncateToWidth(left, leftBudget, "…")} ${right}`;
	}
	return `${left}${" ".repeat(Math.max(0, width - leftWidth - rightWidth))}${right}`;
}

function sameConfig(a: GlanceConfig, b: GlanceConfig): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function shortcut(colors: PaneColors, key: string, label: string): string {
	return `${colors.accent(`[${key}]`)} ${colors.dim(label)}`;
}

class GlanceConfigPane implements Component {
	private readonly initial: GlanceConfig;
	private draft: GlanceConfig;
	private focus: PaneFocus = "global";
	private globalIndex = 0;
	private segmentIndex = 0;
	private status = "Changes stay local until you press S.";

	constructor(
		initial: GlanceConfig,
		private readonly theme: Theme,
		private readonly done: Done,
		private readonly requestRender: () => void,
		private readonly previewState?: GlanceState,
	) {
		this.initial = cloneConfig(initial);
		this.draft = cloneConfig(initial);
	}

	invalidate(): void {}

	private isDirty(): boolean {
		return !sameConfig(this.draft, this.initial);
	}

	private globalItems(): GlobalItem[] {
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
		const next = this.globalItems()[this.globalIndex];
		this.status = `${item.label} → ${next?.value ?? "updated"}. Press S to save.`;
	}

	private toggleCurrentSegment(): void {
		const segment = this.draft.segments[this.segmentIndex];
		if (!segment) return;
		this.draft = toggleSegment(this.draft, segment.id);
		const updated = this.draft.segments[this.segmentIndex];
		const label = SEGMENT_BY_ID.get(segment.id)?.label ?? segment.id;
		this.status = `${label} ${updated?.enabled ? "enabled" : "disabled"}. Press S to save.`;
	}

	private moveCurrentSegment(direction: -1 | 1): void {
		const segment = this.draft.segments[this.segmentIndex];
		if (!segment) return;
		const nextIndex = this.segmentIndex + direction;
		if (nextIndex < 0 || nextIndex >= this.draft.segments.length) {
			this.status = direction < 0 ? "Already at the top." : "Already at the bottom.";
			return;
		}
		this.draft = moveSegment(this.draft, segment.id, direction);
		this.segmentIndex = nextIndex;
		this.status = "Segment order updated. Press S to save.";
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
			this.status = "Defaults restored locally. Press S to save or Esc to discard.";
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

	private renderGlobalRows(colors: PaneColors): string[] {
		const active = this.focus === "global";
		const items = this.globalItems();
		const labelWidth = Math.max(...items.map((item) => visibleWidth(item.label))) + 2;
		return items.map((item, index) => {
			const selected = active && index === this.globalIndex;
			const cursor = selected ? colors.accent("▶ ") : "  ";
			const labelTone = selected ? colors.accent : active ? colors.muted : colors.dim;
			const valueTone = selected ? colors.accent : active ? colors.muted : colors.dim;
			const label = padRightAnsi(labelTone(item.label), labelWidth);
			const value = valueTone(`[ ${item.value} ]`);
			return `${cursor}${label}${value}`;
		});
	}

	private renderSegmentRows(colors: PaneColors): string[] {
		const active = this.focus === "segments";
		const indexWidth = `${this.draft.segments.length}.`.length + 1;
		return this.draft.segments.map((segment, index) => {
			const selected = active && index === this.segmentIndex;
			const cursor = selected ? colors.accent("▶ ") : "  ";
			const number = padRightAnsi((active ? colors.muted : colors.dim)(`${index + 1}.`), indexWidth);
			const bracketTone = active ? colors.muted : colors.dim;
			const marker = segment.enabled ? (active ? colors.success("●") : colors.dim("●")) : colors.dim("○");
			const label = SEGMENT_BY_ID.get(segment.id)?.label ?? segment.id;
			const labelTone = selected ? colors.accent : active ? colors.muted : colors.dim;
			return `${cursor}${number}${bracketTone("[")}${marker}${bracketTone("]")} ${labelTone(label)}`;
		});
	}

	private renderSettingsColumns(lines: string[], width: number, colors: PaneColors): void {
		const contentWidth = Math.max(20, width - 4);
		const globalHeader = this.focus === "global" ? colors.accent("GLOBAL SETTINGS") : colors.dim("GLOBAL SETTINGS");
		const segmentHeader = this.focus === "segments" ? colors.accent("STATUS SEGMENTS") : colors.dim("STATUS SEGMENTS");
		const segmentHint = this.focus === "segments" ? colors.muted(" priority order") : colors.dim(" priority order");
		const globalRows = this.renderGlobalRows(colors);
		const segmentRows = this.renderSegmentRows(colors);

		if (width < 86) {
			lines.push(plainLine(["  ", globalHeader], width));
			for (const row of globalRows) lines.push(plainLine(["  ", row], width));
			lines.push("");
			lines.push(plainLine(["  ", segmentHeader, segmentHint], width));
			for (const row of segmentRows) lines.push(plainLine(["  ", row], width));
			return;
		}

		const colGap = 6;
		const leftWidth = Math.max(30, Math.floor((contentWidth - colGap) * 0.42));
		const rightWidth = Math.max(30, contentWidth - leftWidth - colGap);
		lines.push(
			plainLine(
				[
					"  ",
					padRightAnsi(globalHeader, leftWidth),
					" ".repeat(colGap),
					truncateToWidth(`${segmentHeader}${segmentHint}`, rightWidth, "…"),
				],
				width,
			),
		);
		lines.push("");
		const rows = Math.max(globalRows.length, segmentRows.length);
		for (let i = 0; i < rows; i++) {
			const left = globalRows[i] ?? "";
			const right = segmentRows[i] ?? "";
			lines.push(
				plainLine(
					[
						"  ",
						padRightAnsi(truncateToWidth(left, leftWidth, "…"), leftWidth),
						" ".repeat(colGap),
						truncateToWidth(right, rightWidth, "…"),
					],
					width,
				),
			);
		}
	}

	private renderHelp(lines: string[], width: number, colors: PaneColors): void {
		const help = [
			shortcut(colors, "Tab", "panel"),
			shortcut(colors, "↑↓", "nav"),
			shortcut(colors, "Enter", "toggle"),
			shortcut(colors, "J/K", "order"),
			shortcut(colors, "S", "save"),
			shortcut(colors, "R", "reset"),
			shortcut(colors, "Esc", "cancel"),
		];
		lines.push(plainLine(["  ", help.join(colors.dim(" · "))], width));
	}

	render(width: number): string[] {
		const t = this.theme;
		const colors: PaneColors = {
			accent: (s: string) => t.fg("accent", s),
			muted: (s: string) => t.fg("muted", s),
			dim: (s: string) => t.fg("dim", s),
			warn: (s: string) => t.fg("warning", s),
			success: (s: string) => t.fg("success", s),
		};
		const dirty = this.isDirty();
		const headerLeft = `${colors.accent(t.bold("◌ pi-glance"))} ${colors.dim("settings")}`;
		const headerRight = dirty ? colors.warn("● Unsaved changes") : colors.success("✓ Saved");
		const lines: string[] = [plainLine(["  ", spreadAnsi(headerLeft, headerRight, Math.max(10, width - 4))], width)];
		lines.push(plainLine(["  ", colors.dim("calm input surface · global config · save applies immediately")], width));
		lines.push("");

		const preview = this.previewState
			? renderInputSurface(this.previewState, this.draft, Math.max(24, width - 4), {
					contentLines: ["Ask pi to improve the input surface..."],
					focused: true,
				})
			: renderInputSurfacePreview(this.draft, Math.max(24, width - 4), {
					contentLines: ["Ask pi to improve the input surface..."],
					focused: true,
				});
		lines.push(plainLine(["  ", colors.accent("PREVIEW")], width));
		for (const previewLine of preview) {
			lines.push(plainLine(["  ", previewLine], width));
		}
		lines.push("");

		this.renderSettingsColumns(lines, width, colors);
		lines.push("");
		this.renderHelp(lines, width, colors);
		return lines;
	}
}

interface GlancePaneUI {
	custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: unknown, done: (result: T) => void) => Component,
	): Promise<T>;
}

export async function showGlancePane(initial: GlanceConfig, ctx: { ui: GlancePaneUI }, previewState?: GlanceState): Promise<PaneResult> {
	return ctx.ui.custom<PaneResult>((tui, theme, _kb, done) => {
		return new GlanceConfigPane(initial, theme, done, () => tui.requestRender(), previewState);
	});
}
