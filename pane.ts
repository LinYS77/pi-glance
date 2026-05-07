import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { cloneConfig, defaultConfig, moveSegment, toggleSegment } from "./config.js";
import { renderInputSurface, renderInputSurfacePreview } from "./renderer.js";
import { SEGMENT_BY_ID } from "./segments.js";
import type {
	ContextDisplayMode,
	ContextUnknownMode,
	GitShaMode,
	GlanceConfig,
	GlanceState,
	GlanceThemeName,
	IconMode,
	ModelThinkingMode,
	SegmentConfig,
	SegmentId,
	TokensCacheMode,
	TokensDisplayMode,
} from "./types.js";

type PaneFocus = "categories" | "settings";
type CategoryId = "general" | SegmentId;
type Category = { id: CategoryId; label: string };
type PaneResult = { action: "save"; config: GlanceConfig } | { action: "cancel" };
type Done = (result: PaneResult) => void;
type SettingKind = "toggle" | "cycle" | "info";
type SettingRow = { label: string; value: string; hint?: string; kind: SettingKind; mutate?: () => void };
type Tone = (text: string) => string;

interface PaneColors {
	accent: Tone;
	muted: Tone;
	dim: Tone;
	warn: Tone;
	success: Tone;
}

const POLL_INTERVALS = [2000, 5000, 10000, 30000] as const;
const CONTEXT_DISPLAY_LABELS: Record<ContextDisplayMode, string> = {
	"percent+tokens": "percent / tokens",
	percent: "percent",
	tokens: "tokens",
};
const TOKENS_DISPLAY_LABELS: Record<TokensDisplayMode, string> = {
	"input-output": "input / output",
	total: "total",
};

function nextIn<T extends string>(current: T, values: readonly T[]): T {
	const index = values.indexOf(current);
	return values[(index + 1) % values.length] ?? values[0]!;
}

function nextNumber<T extends number>(current: number, values: readonly T[]): T {
	const index = values.indexOf(current as T);
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

function onOff(value: boolean): string {
	return value ? "on" : "off";
}

function segmentLabel(id: SegmentId): string {
	return SEGMENT_BY_ID.get(id)?.label ?? id;
}

function formatPolling(ms: number): string {
	if (ms % 1000 === 0) return `${ms / 1000}s`;
	return `${ms}ms`;
}

function contextDisplayLabel(mode: ContextDisplayMode): string {
	return CONTEXT_DISPLAY_LABELS[mode];
}

function tokensDisplayLabel(mode: TokensDisplayMode): string {
	return TOKENS_DISPLAY_LABELS[mode];
}

class GlanceConfigPane implements Component {
	private readonly initial: GlanceConfig;
	private draft: GlanceConfig;
	private focus: PaneFocus = "categories";
	private catIndex = 0;
	private setIndex = 0;
	private status = "";

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

	private getCategories(): Category[] {
		return [
			{ id: "general", label: "General" },
			...this.draft.segments.map((segment) => ({
				id: segment.id,
				label: segmentLabel(segment.id),
			})),
		];
	}

	private getSettings(id: CategoryId): SettingRow[] {
		switch (id) {
			case "general":
				return this.generalRows();
			case "git":
				return this.gitRows();
			case "context":
				return this.contextRows();
			case "cost":
				return this.costRows();
			case "tokens":
				return this.tokensRows();
			case "model":
				return this.modelRows();
			default:
				return [];
		}
	}

	private generalRows(): SettingRow[] {
		return [
			{
				label: "Enabled",
				value: onOff(this.draft.enabled),
				hint: "Temporarily disable pi-glance.",
				kind: "toggle",
				mutate: () => {
					this.draft.enabled = !this.draft.enabled;
				},
			},
			{
				label: "Theme",
				value: this.draft.theme,
				hint: "Switch the palette.",
				kind: "cycle",
				mutate: () => {
					this.draft.theme = nextIn(this.draft.theme, ["light", "dark"] as GlanceThemeName[]);
				},
			},
			{
				label: "Icons",
				value: this.draft.icons,
				hint: "Plain works without Nerd Font.",
				kind: "cycle",
				mutate: () => {
					this.draft.icons = nextIn(this.draft.icons, ["plain", "nerd"] as IconMode[]);
				},
			},
			{
				label: "Min input rows",
				value: `${this.draft.editor.minContentRows}`,
				hint: "Set the resting editor height.",
				kind: "cycle",
				mutate: () => {
					this.draft.editor.minContentRows = nextNumber(this.draft.editor.minContentRows, [2, 3, 4] as const);
				},
			},
			{
				label: "Adaptive width",
				value: onOff(this.draft.display.adaptive),
				hint: "Drop later segments first.",
				kind: "toggle",
				mutate: () => {
					this.draft.display.adaptive = !this.draft.display.adaptive;
				},
			},
		];
	}

	private contextRows(): SettingRow[] {
		return this.segmentRows("context", [
			{
				label: "Display",
				value: contextDisplayLabel(this.draft.context.display),
				hint: "Choose percent, tokens, or both.",
				kind: "cycle",
				mutate: () => {
					this.draft.context.display = nextIn(this.draft.context.display, ["percent+tokens", "percent", "tokens"] as ContextDisplayMode[]);
				},
			},
			{
				label: "Unknown",
				value: this.draft.context.unknown,
				hint: "Hide when usage is unknown.",
				kind: "cycle",
				mutate: () => {
					this.draft.context.unknown = nextIn(this.draft.context.unknown, ["show", "hide"] as ContextUnknownMode[]);
				},
			},
		]);
	}

	private costRows(): SettingRow[] {
		return this.segmentRows("cost", [
			{
				label: "Hide zero",
				value: onOff(this.draft.cost.hideZero),
				hint: "Hide until cost is non-zero.",
				kind: "toggle",
				mutate: () => {
					this.draft.cost.hideZero = !this.draft.cost.hideZero;
				},
			},
			{
				label: "Display",
				value: "compact USD",
				hint: "Compact session cost.",
				kind: "info",
			},
		]);
	}

	private tokensRows(): SettingRow[] {
		return this.segmentRows("tokens", [
			{
				label: "Display",
				value: tokensDisplayLabel(this.draft.tokens.display),
				hint: "Choose input/output or total.",
				kind: "cycle",
				mutate: () => {
					this.draft.tokens.display = nextIn(this.draft.tokens.display, ["input-output", "total"] as TokensDisplayMode[]);
				},
			},
			{
				label: "Cache",
				value: this.draft.tokens.cache,
				hint: "Show or hide cache details.",
				kind: "cycle",
				mutate: () => {
					this.draft.tokens.cache = nextIn(this.draft.tokens.cache, ["auto", "show", "hide"] as TokensCacheMode[]);
				},
			},
		]);
	}

	private modelRows(): SettingRow[] {
		return this.segmentRows("model", [
			{
				label: "Provider label",
				value: this.draft.display.showProvider,
				hint: "Show provider name.",
				kind: "cycle",
				mutate: () => {
					this.draft.display.showProvider = nextIn(this.draft.display.showProvider, ["auto", "always", "never"] as const);
				},
			},
			{
				label: "Thinking label",
				value: this.draft.model.showThinking,
				hint: "Show thinking level.",
				kind: "cycle",
				mutate: () => {
					this.draft.model.showThinking = nextIn(this.draft.model.showThinking, ["auto", "always", "never"] as ModelThinkingMode[]);
				},
			},
		]);
	}

	private gitRows(): SettingRow[] {
		return this.segmentRows("git", [
			{
				label: "Dirty marker",
				value: onOff(this.draft.git.showDirty),
				hint: "Conflicts always stay visible.",
				kind: "toggle",
				mutate: () => {
					this.draft.git.showDirty = !this.draft.git.showDirty;
				},
			},
			{
				label: "Ahead / behind",
				value: onOff(this.draft.git.showAheadBehind),
				hint: "Show upstream counts.",
				kind: "toggle",
				mutate: () => {
					this.draft.git.showAheadBehind = !this.draft.git.showAheadBehind;
				},
			},
			{
				label: "SHA",
				value: this.draft.git.shaMode,
				hint: "Keep branches quiet unless enabled.",
				kind: "cycle",
				mutate: () => {
					this.draft.git.shaMode = nextIn(this.draft.git.shaMode, ["off", "detached", "always"] as GitShaMode[]);
				},
			},
			{
				label: "Polling",
				value: formatPolling(this.draft.git.pollIntervalMs),
				hint: "Check external Git changes.",
				kind: "cycle",
				mutate: () => {
					this.draft.git.pollIntervalMs = nextNumber(this.draft.git.pollIntervalMs, POLL_INTERVALS);
				},
			},
		]);
	}

	private segmentRows(id: SegmentId, rows: SettingRow[]): SettingRow[] {
		const segment = this.draft.segments.find((s) => s.id === id);
		return [
			{
				label: "Enabled",
				value: onOff(Boolean(segment?.enabled)),
				hint: "Show or hide this segment.",
				kind: "toggle",
				mutate: () => {
					this.draft = toggleSegment(this.draft, id);
				},
			},
			...rows,
		];
	}

	private activateCurrent(): void {
		const cat = this.getCategories()[this.catIndex];
		if (!cat) return;
		const settings = this.getSettings(cat.id);
		const row = settings[this.setIndex];
		if (!row) return;

		if (!row.mutate) {
			this.status = row.hint ?? `${row.label} is informational.`;
			return;
		}

		row.mutate();
		const next = this.getSettings(cat.id)[this.setIndex];
		this.status = `${row.label} → ${next?.value ?? "updated"}. Press S to save.`;
	}

	private moveCurrentSegment(direction: -1 | 1): void {
		if (this.catIndex === 0) {
			this.status = "Cannot move General settings.";
			return;
		}
		const segment = this.draft.segments[this.catIndex - 1];
		if (!segment) return;

		const targetCatIndex = this.catIndex + direction;
		if (targetCatIndex < 1 || targetCatIndex > this.draft.segments.length) {
			this.status = direction < 0 ? "Already at the top." : "Already at the bottom.";
			return;
		}

		this.draft = moveSegment(this.draft, segment.id, direction);
		this.catIndex = targetCatIndex;
		this.status = "Segment order updated. Press S to save.";
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.ctrl("c"))) {
			this.done({ action: "cancel" });
			return;
		}
		if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
			if (this.focus === "settings") {
				this.focus = "categories";
				this.requestRender();
			} else {
				this.done({ action: "cancel" });
			}
			return;
		}
		if (matchesKey(data, Key.left)) {
			if (this.focus === "settings") {
				this.focus = "categories";
				this.requestRender();
			}
			return;
		}
		if (matchesKey(data, Key.right)) {
			if (this.focus === "categories") {
				this.focus = "settings";
				this.setIndex = 0;
				this.requestRender();
			}
			return;
		}
		if (data === "s" || data === "S") {
			this.done({ action: "save", config: cloneConfig(this.draft) });
			return;
		}
		if (data === "r" || data === "R") {
			this.draft = defaultConfig();
			this.focus = "categories";
			this.catIndex = 0;
			this.setIndex = 0;
			this.status = "Defaults restored locally. Press S to save or Esc to discard.";
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.up)) {
			if (this.focus === "categories") {
				const count = this.getCategories().length;
				this.catIndex = count === 0 ? 0 : (this.catIndex - 1 + count) % count;
				this.setIndex = 0;
			} else {
				const cat = this.getCategories()[this.catIndex];
				const count = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = count === 0 ? 0 : (this.setIndex - 1 + count) % count;
			}
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			if (this.focus === "categories") {
				const count = this.getCategories().length;
				this.catIndex = count === 0 ? 0 : (this.catIndex + 1) % count;
				this.setIndex = 0;
			} else {
				const cat = this.getCategories()[this.catIndex];
				const count = cat ? this.getSettings(cat.id).length : 0;
				this.setIndex = count === 0 ? 0 : (this.setIndex + 1) % count;
			}
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			if (this.focus === "categories") {
				this.focus = "settings";
				this.setIndex = 0;
			} else {
				this.activateCurrent();
			}
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.space)) return;
		if (this.focus === "categories" && (data === "k" || data === "K")) {
			this.moveCurrentSegment(-1);
			this.requestRender();
			return;
		}
		if (this.focus === "categories" && (data === "j" || data === "J")) {
			this.moveCurrentSegment(1);
			this.requestRender();
		}
	}

	private renderPreview(lines: string[], width: number, colors: PaneColors): void {
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
	}

	private renderLeftPane(colors: PaneColors): string[] {
		const cats = this.getCategories();
		return cats.map((cat, i) => {
			const selectedCat = i === this.catIndex;
			const hasFocus = this.focus === "categories";
			const segment = cat.id === "general" ? undefined : this.draft.segments.find((s) => s.id === cat.id);

			let cursor = "  ";
			let labelTone = colors.muted;

			if (selectedCat) {
				cursor = hasFocus ? colors.accent("› ") : colors.muted("› ");
				labelTone = hasFocus ? colors.accent : colors.muted;
			} else if (segment && !segment.enabled) {
				labelTone = colors.dim;
			}

			const marker = segment ? `${(segment.enabled ? colors.muted : colors.dim)(segment.enabled ? "●" : "○")} ` : "";
			return `${cursor}${marker}${labelTone(cat.label)}`;
		});
	}

	private renderSettingValue(row: SettingRow, selected: boolean, hasFocus: boolean, colors: PaneColors): string {
		if (row.kind === "info") return colors.dim(row.value);
		const valueTone = selected && hasFocus ? colors.accent : row.value === "on" ? colors.success : row.value === "off" ? colors.dim : colors.muted;
		return `${colors.dim("[ ")}${valueTone(row.value)}${colors.dim(" ]")}`;
	}

	private renderRightPane(colors: PaneColors): string[] {
		const rows: string[] = [];
		const cat = this.getCategories()[this.catIndex];
		if (!cat) return rows;

		const title = cat.id === "general" ? "GENERAL" : `${cat.label.toUpperCase()} SETTINGS`;
		rows.push(colors.accent(title));

		const settings = this.getSettings(cat.id);
		if (settings.length === 0) {
			rows.push(colors.dim("No settings available."));
			return rows;
		}

		const labelWidth = Math.max(...settings.map((s) => visibleWidth(s.label))) + 2;

		for (let i = 0; i < settings.length; i++) {
			const s = settings[i]!;
			const selectedSet = i === this.setIndex;
			const hasFocus = this.focus === "settings";

			let cursor = "  ";
			let labelTone = colors.muted;

			if (selectedSet && hasFocus) {
				cursor = colors.accent("› ");
				labelTone = colors.accent;
			} else if (s.kind === "info") {
				labelTone = colors.dim;
			}

			const marker = s.kind === "info" ? colors.dim(" ") : selectedSet && hasFocus ? colors.accent("•") : colors.dim("•");
			const paddedLabel = padRightAnsi(labelTone(s.label), labelWidth);
			const valStr = this.renderSettingValue(s, selectedSet, hasFocus, colors);

			rows.push(`${cursor}${marker} ${paddedLabel}${valStr}`);
		}

		const selectedHint = settings[this.setIndex]?.hint;
		rows.push("");
		rows.push(selectedHint ? colors.dim(selectedHint) : "");

		return rows;
	}

	private renderDualPane(lines: string[], width: number, colors: PaneColors): void {
		const lefts = this.renderLeftPane(colors);
		const rights = this.renderRightPane(colors);

		const leftWidth = 22;
		const sep = colors.dim("   │   ");

		const maxLines = Math.max(lefts.length, rights.length);
		for (let i = 0; i < maxLines; i++) {
			const l = padRightAnsi(lefts[i] ?? "", leftWidth);
			const r = rights[i] ?? "";
			lines.push(plainLine(["  ", l, sep, r], width));
		}
	}

	private renderHelp(lines: string[], width: number, colors: PaneColors): void {
		const help =
			this.focus === "categories"
				? [
						shortcut(colors, "↑↓", "nav"),
						shortcut(colors, "Enter/→", "edit"),
						shortcut(colors, "J/K", "switch"),
						shortcut(colors, "S", "save"),
						shortcut(colors, "R", "reset"),
						shortcut(colors, "Esc", "cancel"),
					]
				: [
						shortcut(colors, "↑↓", "nav"),
						shortcut(colors, "Enter", "change"),
						shortcut(colors, "←/Esc", "back"),
						shortcut(colors, "S", "save"),
						shortcut(colors, "R", "reset"),
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
		if (this.status) lines.push(plainLine(["  ", colors.dim(this.status)], width));
		lines.push("");

		this.renderPreview(lines, width, colors);
		lines.push("");

		lines.push(plainLine(["  ", colors.accent("SETTINGS")], width));
		this.renderDualPane(lines, width, colors);

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
