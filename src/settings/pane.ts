import {
	Input,
	Key,
	decodeKittyPrintable,
	matchesKey,
	parseKey,
	SelectList,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
	type Keybinding,
	type KeyId,
	type TUI,
} from "@earendil-works/pi-tui";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	createPaneModel,
	createPaneViewModel,
	updatePaneModel,
	type PaneIntent,
	type PaneModelState,
	type GlancePaneViewModel,
	type HelpShortcut,
} from "./model.js";
import { shortcutConflict } from "../input/keybinding.js";
import { normalizeStashShortcut, shortcutLabel } from "../input/shortcut.js";
import { SETTINGS_SECTIONS } from "./catalog.js";
import { WorkingSweep, type ScheduleSweepFrame } from "../runtime/working-sweep.js";
import { truncateStyledText } from "../surface/text.js";
import { createInputSurfaceRenderer } from "../surface/renderer.js";
import type { GlanceRenderStyleContext } from "../theme/adapter.js";
import type { GlanceConfig, GlanceState } from "../types.js";

type PaneResult = { action: "save"; config: GlanceConfig } | { action: "cancel" };
export interface GlancePaneOptions {
	readonly previewNowMs?: () => number;
	readonly schedulePreviewFrame?: ScheduleSweepFrame;
	readonly renderStyleContext?: GlanceRenderStyleContext;
}

/** Keep settings reachable when preview, terminal height or palette names change. */
function viewport(total: number, selected: number, count: number): { start: number; end: number } {
	const start = Math.max(0, Math.min(total - count, selected - Math.floor(count / 2)));
	return { start, end: Math.min(total, start + count) };
}
function spread(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	if (rightWidth + 4 >= width) return truncateStyledText(`${left} ${right}`, width, "");
	const first = truncateStyledText(left, width - rightWidth - 2, "…");
	return first + " ".repeat(Math.max(1, width - visibleWidth(first) - rightWidth)) + right;
}

function wrapShortcuts(items: string[], width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const item of items) {
		if (line && visibleWidth(`${line}  ${item}`) > width) {
			lines.push(line);
			line = "";
		}
		line += (line ? "  " : "") + item;
	}
	if (line) lines.push(line);
	return lines;
}

export class GlanceConfigPane implements Component, Focusable {
	private model: PaneModelState;
	private view: GlancePaneViewModel;
	private readonly renderSurface: ReturnType<typeof createInputSurfaceRenderer>;
	private previewVisible = true;
	private readonly clock: WorkingSweep;
	private input = new Input();
	private replaceNumberOnType = false;
	private numberPasting = false;
	private shortcutPasting = false;
	private disposed = false;
	private hasFocus = false;
	private pageSize = 5;

	get focused(): boolean {
		return this.hasFocus;
	}
	set focused(value: boolean) {
		this.hasFocus = value;
		this.input.focused = value && this.model.page.kind === "number";
	}

	constructor(
		initial: GlanceConfig,
		private readonly theme: Pick<Theme, "fg"> & Partial<Pick<Theme, "bg">>,
		private readonly done: (result: PaneResult) => void,
		private readonly requestRender: () => void,
		private readonly keybindings?: Pick<KeybindingsManager, "matches" | "getKeys"> & Partial<Pick<KeybindingsManager, "getEffectiveConfig">>,
		private readonly getTerminalRows: () => number | undefined = () => undefined,
		previewState?: GlanceState,
		private readonly options: GlancePaneOptions = {},
	) {
		this.model = createPaneModel(initial);
		this.view = createPaneViewModel(this.model);
		this.renderSurface = createInputSurfaceRenderer(previewState);
		this.clock = new WorkingSweep({
			nowMs: options.previewNowMs ?? (() => performance.now()),
			ownsEditor: () => !this.disposed,
			requestRender,
			setWorkingVisible: () => {},
			schedule: options.schedulePreviewFrame,
		});
		this.clock.setSpeed(initial.editor.workingSweepSpeed);
		this.clock.attach();
	}
	invalidate(): void {
		this.input.invalidate();
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clock.dispose();
	}
	private matches(data: string, action: Keybinding, fallback: KeyId): boolean {
		return this.keybindings ? this.keybindings.matches(data, action) : matchesKey(data, fallback);
	}
	private bindingLabel(action: Keybinding, fallback: string): string | undefined {
		const configured = this.keybindings?.getKeys?.(action);
		if (configured === undefined) return fallback;
		const key = configured.find((key) => key !== "ctrl+c"); // Ctrl-C always discards the entire pane.
		if (!key) return undefined;
		const labels: Record<string, string> = {
			ctrl: "Ctrl",
			shift: "Shift",
			alt: "Alt",
			super: "Super",
			enter: "Enter",
			escape: "Esc",
			tab: "Tab",
			up: "↑",
			down: "↓",
			left: "←",
			right: "→",
			space: "Space",
		};
		return key
			.split("+")
			.map((part) => labels[part] ?? (part.length === 1 ? part.toUpperCase() : part))
			.join("+");
	}
	private shortcut(item: HelpShortcut): string {
		let key: string | undefined = item.key;
		if (this.model.page.kind === "shortcut") key = item.key;
		else if (key === "Enter") key = this.bindingLabel("tui.select.confirm", "Enter");
		else if (key === "Esc") {
			key = this.bindingLabel("tui.select.cancel", "Esc");
			if (!key) return "[Ctrl+C] Discard & close";
		} else if (key === "↑↓") {
			const up = this.bindingLabel("tui.select.up", "↑"),
				down = this.bindingLabel("tui.select.down", "↓");
			key = up === "↑" && down === "↓" ? "↑↓" : [up, down].filter(Boolean).join("/");
		} else if (key === "Tab/Shift+Tab")
			key = [this.bindingLabel("tui.input.tab", "Tab"), "Shift+Tab"].filter(Boolean).join("/");
		return key ? `[${key}] ${item.label}` : "";
	}
	private editNumber(data: string): void {
		const startsPaste = data.includes("\x1b[200~");
		if (
			this.replaceNumberOnType &&
			(/^[\x20-\x7e]+$/.test(data) || decodeKittyPrintable(data) !== undefined || startsPaste)
		)
			this.input.setValue("");
		this.replaceNumberOnType = false;
		if (startsPaste) this.numberPasting = true;
		const pasteEnd = data.indexOf("\x1b[201~");
		const end = pasteEnd < 0 ? data.length : pasteEnd + 6;
		this.input.handleInput(data.slice(0, end));
		if (pasteEnd >= 0) this.numberPasting = false;
		this.dispatch({ type: "input", text: this.input.getValue() });
		if (end < data.length) this.handleInput(data.slice(end));
	}
	private dispatch(intent: PaneIntent): void {
		const wasNumber = this.model.page.kind === "number";
		const result = updatePaneModel(this.model, intent);
		this.model = result.model;
		this.view = createPaneViewModel(this.model);
		if (result.completion) {
			this.dispose();
			this.done(result.completion);
			return;
		}
		if (this.model.page.kind === "number" && !wasNumber) {
			this.input = new Input();
			this.input.handleInput(`\x1b[200~${this.model.page.text}\x1b[201~`);
			this.replaceNumberOnType = true;
			this.numberPasting = false;
		}
		this.input.focused = this.hasFocus && this.model.page.kind === "number";
		this.clock.setSpeed(this.model.draft.editor.workingSweepSpeed);
		if (this.view.preview.working) this.clock.start();
		else this.clock.settle();
		this.requestRender();
	}
	handleInput(data: string): void {
		if (this.disposed) return;
		// Paste payload is text, even when delivered in chunks containing command keys.
		if (this.model.page.kind === "number" && (this.numberPasting || data.includes("\x1b[200~"))) {
			this.editNumber(data);
			return;
		}
		if (this.model.page.kind === "shortcut" && (this.shortcutPasting || data.includes("\x1b[200~"))) {
			this.shortcutPasting = true;
			const end = data.indexOf("\x1b[201~");
			this.dispatch({ type: "shortcut", error: "Press a shortcut; pasted text cannot be bound." });
			if (end >= 0) {
				this.shortcutPasting = false;
				if (end + 6 < data.length) this.handleInput(data.slice(end + 6));
			}
			return;
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			this.dispatch({ type: "cancel" });
			return;
		}
		if (this.model.page.kind === "shortcut") {
			if (matchesKey(data, "escape")) this.dispatch({ type: "back" });
			else if (matchesKey(data, "enter")) this.dispatch({ type: "activate" });
			else {
				const key = normalizeStashShortcut(parseKey(data));
				const getEffectiveConfig = this.keybindings?.getEffectiveConfig;
				const conflict = key && getEffectiveConfig ? shortcutConflict(data, key, { getEffectiveConfig: () => getEffectiveConfig.call(this.keybindings) }) : undefined;
				this.dispatch({ type: "shortcut", key, error: conflict ? `Used by Pi: ${conflict}. Choose another shortcut.` : undefined });
			}
			return;
		}
		if (this.matches(data, "tui.select.cancel", Key.escape)) {
			this.dispatch({ type: "back" });
			return;
		}
		if (this.matches(data, "tui.select.confirm", Key.enter)) {
			this.dispatch({ type: "activate" });
			return;
		}
		// Text entry owns letters and arrows; S/R/Q must not save/reset/close it.
		if (this.model.page.kind === "number") {
			this.editNumber(data);
			return;
		}
		if (this.matches(data, "tui.select.up", Key.up)) this.dispatch({ type: "move", direction: "up" });
		else if (this.matches(data, "tui.select.down", Key.down)) this.dispatch({ type: "move", direction: "down" });
		else if (this.matches(data, "tui.select.pageUp", Key.pageUp))
			this.dispatch({ type: "move", direction: "up", amount: this.pageSize });
		else if (this.matches(data, "tui.select.pageDown", Key.pageDown))
			this.dispatch({ type: "move", direction: "down", amount: this.pageSize });
		else if (this.matches(data, "tui.input.tab", Key.tab)) this.dispatch({ type: "section", direction: 1 });
		else if (matchesKey(data, Key.shift("tab"))) this.dispatch({ type: "section", direction: -1 });
		else if (matchesKey(data, Key.left)) this.dispatch({ type: "adjust", direction: -1 });
		else if (matchesKey(data, Key.right)) this.dispatch({ type: "adjust", direction: 1 });
		else if (matchesKey(data, Key.space)) this.dispatch({ type: "toggle" });
		else if (/^[sS]$/.test(data)) this.dispatch({ type: "save" });
		else if (/^[rR]$/.test(data)) this.dispatch({ type: "reset" });
		else if (/^[qQ]$/.test(data)) this.dispatch({ type: "back" });
		else if (/^[dD]$/.test(data)) this.dispatch({ type: "density" });
		else if (/^[jJ]$/.test(data)) this.dispatch({ type: "reorder", direction: 1 });
		else if (/^[kK]$/.test(data)) this.dispatch({ type: "reorder", direction: -1 });
	}

	private fg(tone: "accent" | "muted" | "dim" | "warning" | "success", text: string): string {
		return this.theme.fg(tone, text);
	}
	private renderPreview(view: GlancePaneViewModel, width: number): string[] {
		const config = view.preview.config;
		if (!config.enabled)
			return [this.fg("dim", "Preview · Glance is off"), this.fg("dim", "Turn Glance on to preview the editor.")];
		const options = {
			...this.options.renderStyleContext,
			...(view.preview.ambientTone ? { ambientTone: view.preview.ambientTone } : {}),
			...(view.preview.density === "auto" ? {} : { previewDensity: view.preview.density }),
			workingElapsedMs: view.preview.working ? this.clock.elapsedMs() : undefined,
			contentLines: ["Your next prompt…"],
			focused: true,
		};
		const preview = this.renderSurface(config, width, options);
		const densityLabel = view.preview.density[0]!.toUpperCase() + view.preview.density.slice(1);
		const label =
			view.section === "status"
				? `Preview · ${densityLabel}`
				: `Preview${view.preview.working ? ` · Working · ${config.editor.workingSweepSpeed} cols/s` : ""}`;
		return [this.fg("dim", label), ...preview];
	}
	private renderRow(row: GlancePaneViewModel["rows"][number], width: number): string {
		const mark = row.selected ? "› " : "  ";
		const value =
			row.kind === "number"
				? `‹ ${row.value} ›`
				: row.value + (row.kind === "theme" || row.kind === "choice" || row.kind === "segment" || row.kind === "shortcut" ? "  ›" : "");
		const left = mark + row.label + (row.changed ? " *" : "");
		const tone = row.selected ? "accent" : row.value === "Off" ? "dim" : "muted";
		const rendered = this.fg(tone, spread(left, value, width));
		return row.selected ? (this.theme.bg?.("selectedBg", rendered) ?? rendered) : rendered;
	}
	render(availableWidth: number): string[] {
		const width = Math.max(0, Math.min(100, Math.floor(availableWidth)));
		const terminalRows = this.getTerminalRows();
		const height = Math.max(1, Number.isFinite(terminalRows) ? Math.floor(terminalRows!) - 2 : 30);
		const view = this.view;
		const sectionIndex = SETTINGS_SECTIONS.findIndex((section) => section.id === view.section);
		const tabs =
			width >= 64
				? SETTINGS_SECTIONS.map((section) =>
						section.id === view.section
							? this.fg("accent", `[ ${section.label} ]`)
							: this.fg("muted", `  ${section.label}  `),
					).join(" ")
				: this.fg("accent", `${SETTINGS_SECTIONS[sectionIndex]!.label} (${sectionIndex + 1}/${SETTINGS_SECTIONS.length})`);
		const header = [
			spread(
				this.fg("accent", "◌ Glance"),
				this.fg(view.dirty ? "warning" : "dim", view.dirty ? "Unsaved changes" : "No changes"),
				width,
			),
			tabs,
		];
		const help = view.help.map((item) => this.shortcut(item)).filter(Boolean);
		const footer = wrapShortcuts(help, Math.max(1, width))
			.slice(0, 2)
			.map((line) => this.fg("dim", line));
		const actions = view.actions.map((item) => this.shortcut(item)).filter(Boolean);
		footer.push(
			...wrapShortcuts(actions, Math.max(1, width))
				.slice(0, 2)
				.map((line) => this.fg("accent", line)),
		);
		const hint = wrapTextWithAnsi(
			this.fg(this.model.page.kind === "number" && this.model.page.error || this.model.page.kind === "shortcut" && this.model.page.error ? "warning" : "dim", view.hint),
			Math.max(1, width),
		).slice(0, 2);
		let preview = this.renderPreview(view, width);
		const title = this.fg("muted", view.title);
		const base = header.length + 1 + hint.length + footer.length + 2;
		const minimumRows =
			view.page === "number" || view.page === "shortcut" ? 1 : Math.min(4, view.page === "list" ? view.rows.length : view.choices.length);
		const showPreview = height - base - preview.length >= minimumRows;
		if (showPreview !== this.previewVisible) {
			this.previewVisible = showPreview;
			this.clock.setWaiting(!showPreview);
			if (showPreview) preview = this.renderPreview(view, width);
		}
		const prefix = [...header, ...(showPreview ? preview : []), title];
		const budget = Math.max(1, height - prefix.length - hint.length - footer.length - 1);
		const body: string[] = [];
		if (view.page === "shortcut" && this.model.page.kind === "shortcut") {
			body.push(this.fg("accent", shortcutLabel(this.model.page.key)));
		} else if (view.page === "number") {
			body.push(...this.input.render(Math.max(1, width)));
		} else if (view.page !== "list") {
			this.pageSize = Math.max(1, Math.min(8, budget - 1));
			const list = new SelectList(
				view.choices.map((choice, index) => ({
					value: String(index),
					label: `${choice.checked ? "✓ " : "  "}${choice.label}`,
				})),
				this.pageSize,
				{
					selectedPrefix: (text) => this.fg("accent", text),
					selectedText: (text) => this.fg("accent", text),
					description: (text) => this.fg("dim", text),
					scrollInfo: (text) => this.fg("dim", text),
					noMatch: (text) => this.fg("warning", text),
				},
			);
			list.setSelectedIndex(
				Math.max(
					0,
					view.choices.findIndex((choice) => choice.selected),
				),
			);
			body.push(...list.render(Math.max(1, width)));
		} else {
			const count = Math.max(1, Math.min(8, budget - (view.rows.length > budget ? 1 : 0)));
			this.pageSize = count;
			const selected = Math.max(
				0,
				view.rows.findIndex((row) => row.selected),
			);
			const { start, end } = viewport(view.rows.length, selected, count);
			body.push(...view.rows.slice(start, end).map((row) => this.renderRow(row, width)));
			if (start > 0 || end < view.rows.length)
				body.push(
					this.fg(
						"dim",
						`${start + 1}–${end} of ${view.rows.length} · ${this.shortcut({ key: "↑↓", label: "Scroll" })}`,
					),
				);
		}
		let lines = [...prefix, ...body.slice(0, budget), "", ...hint, ...footer];
		// At tiny heights keep the selected setting and an exit hint, not a clipped header.
		if (lines.length > height) {
			const selected = view.rows.find((row) => row.selected);
			const confirm = view.help.find((item) => item.key === "Enter") ?? view.actions[0]!;
			const cancel = view.actions.find((item) => item.key === "Esc")!;
			lines = [
				view.page === "list" && selected ? this.renderRow(selected, width) : (body[0] ?? title),
				this.fg("dim", `${this.shortcut(confirm)}  ${this.shortcut(cancel)}`),
			].slice(0, height);
		}
		const indent = " ".repeat(Math.max(0, Math.floor((availableWidth - width) / 2)));
		return lines.map((line) => indent + truncateStyledText(line, width));
	}
}

interface GlancePaneUI {
	custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) => Component,
	): Promise<T>;
}
export async function showGlancePane(
	initial: GlanceConfig,
	ctx: { ui: GlancePaneUI },
	previewState?: GlanceState,
	options: GlancePaneOptions = {},
): Promise<PaneResult> {
	let pane: GlanceConfigPane | undefined;
	try {
		return await ctx.ui.custom<PaneResult>((tui, theme, keybindings, done) => {
			pane = new GlanceConfigPane(
				initial,
				theme,
				done,
				() => tui.requestRender(),
				keybindings,
				() => tui.terminal?.rows,
				previewState,
				options,
			);
			return pane;
		});
	} finally {
		pane?.dispose();
	}
}
