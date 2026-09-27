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
	type TUI,
} from "@earendil-works/pi-tui";
import type { ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	createPaneModel,
	createPaneViewModel,
	updatePaneModel,
	type PaneIntent,
	type PaneModelState,
	type GlancePaneViewModel,
	type HelpShortcut,
	type PaneCommit,
	type PaneCommitResult,
	type PanePersistence,
} from "./model.js";
import { shortcutConflict } from "../input/keybinding.js";
import { normalizeStashShortcut, shortcutLabel } from "../input/shortcut.js";
import { resolvePaneBindings } from "./bindings.js";
import { SETTINGS_SECTIONS } from "./catalog.js";
import { ActivityClock, activityMotion, type ScheduleActivityFrame } from "../runtime/activity-animation.js";
import { extensionStatusEntries, EXTENSION_STATUS_RESET } from "../surface/extension-statuses.js";
import { truncateStyledText } from "../surface/text.js";
import { createInputSurfaceRenderer } from "../surface/renderer.js";
import type { GlanceRenderStyleContext } from "../theme/adapter.js";
import type { ExtensionStatusSource, GlanceConfig, GlanceState } from "../types.js";

type PaneResult = { action: "save"; config: GlanceConfig } | { action: "cancel" };
export interface GlancePaneOptions {
	readonly commit?: PaneCommit;
	readonly persistence?: PanePersistence;
	readonly getPreviewState?: () => GlanceState;
	readonly getExtensionStatuses?: ExtensionStatusSource;
	readonly previewNowMs?: () => number;
	readonly schedulePreviewFrame?: ScheduleActivityFrame;
	readonly renderStyleContext?: GlanceRenderStyleContext;
}

/** Reserve bounded content slots so changing pages does not move the preview in regular mode. */
const LIST_ROWS = 8;
const HINT_ROWS = 2;
const SHORTCUT_ROWS = 4;
function fitRows(lines: string[], count: number): string[] {
	return [...lines.slice(0, count), ...Array(Math.max(0, count - lines.length)).fill("")];
}

/** Keep settings reachable when preview, terminal height or palette names change. */
function viewport(total: number, selected: number, count: number): { start: number; end: number } {
	const start = Math.max(0, Math.min(total - count, selected - Math.floor(count / 2)));
	return { start, end: Math.min(total, start + count) };
}
function spread(left: string, right: string, width: number): string {
	const safeWidth = Math.max(0, width);
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	if (leftWidth + rightWidth + 2 <= safeWidth) return left + " ".repeat(safeWidth - leftWidth - rightWidth) + right;
	if (safeWidth <= 1) return truncateStyledText(left || right, safeWidth, "");
	const leftFloor = Math.min(leftWidth, Math.max(1, Math.min(20, Math.floor(safeWidth * 0.45))));
	const rightBudget = Math.max(1, safeWidth - leftFloor - 2);
	const fittedRight = truncateStyledText(right, rightBudget, "…");
	const fittedLeft = truncateStyledText(left, Math.max(1, safeWidth - visibleWidth(fittedRight) - 1), "…");
	return fittedLeft + " ".repeat(Math.max(1, safeWidth - visibleWidth(fittedLeft) - visibleWidth(fittedRight))) + fittedRight;
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
	private readonly previewSource: "Live" | "Example";
	private previewVisible = true;
	private readonly clock: ActivityClock;
	private input = new Input();
	private replaceNumberOnType = false;
	private pasteTarget?: "number" | "shortcut" | "ignore";
	private disposed = false;
	private saving = false;
	private saveError = "";
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
		this.previewSource = options.getPreviewState || previewState ? "Live" : "Example";
		this.renderSurface = createInputSurfaceRenderer(options.getPreviewState ?? previewState);
		this.clock = new ActivityClock({
			nowMs: options.previewNowMs,
			getMotion: () => activityMotion(this.model.draft, this.view.preview.activity === "idle" ? undefined : this.view.preview.activity),
			isPaused: () => this.disposed || this.saving || !this.previewVisible,
			requestRender,
			schedule: options.schedulePreviewFrame,
		});
	}
	invalidate(): void {
		this.input.invalidate();
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clock.dispose();
	}
	private bindings() {
		return resolvePaneBindings(this.saving ? [] : [...this.view.help, ...this.view.actions]
			.filter(item => item.key !== "S" || this.options.persistence?.writable !== false),
			this.keybindings, this.pageSize, this.model.page.kind === "shortcut");
	}
	private helpLines(): string[] {
		const hints = (this.view.reference ?? []).filter(item => item.key !== "S" || this.options.persistence?.writable !== false);
		const bindings = resolvePaneBindings(hints, this.keybindings, this.pageSize);
		const lines = hints.map(item => bindings.format(item) || `${item.label}: unavailable (Pi keybinding conflict)`);
		if (hints.some(item => item.key === "↑↓")) lines.push(bindings.format({ key: "Page", label: "Page up / down" }));
		lines.push("[Ctrl+C] Discard & close");
		return lines.filter(Boolean);
	}
	private shortcut(item: HelpShortcut): string {
		return this.bindings().format(item);
	}
	private editNumber(data: string): void {
		const startsPaste = data.includes("\x1b[200~");
		if (
			this.replaceNumberOnType &&
			(/^[\x20-\x7e]+$/.test(data) || decodeKittyPrintable(data) !== undefined || startsPaste)
		)
			this.input.setValue("");
		this.replaceNumberOnType = false;
		this.input.handleInput(data);
		this.dispatch({ type: "input", text: this.input.getValue() });
	}
	private async save(result: Extract<PaneResult, { action: "save" }>): Promise<void> {
		this.saving = true;
		this.saveError = "";
		this.clock.sync();
		this.requestRender();
		let outcome: PaneCommitResult;
		try { outcome = await this.options.commit!(result.config); }
		catch { outcome = { status: "failed", message: "Could not save. Check file permissions and try again." }; }
		if (this.disposed) return;
		this.saving = false;
		if (outcome.status !== "failed") {
			this.dispose();
			this.done(outcome.status === "saved" ? result : { action: "cancel" });
			return;
		}
		this.saveError = `${outcome.message} Press S to retry or keep editing.`;
		this.clock.sync();
		this.requestRender();
	}
	private dispatch(intent: PaneIntent): void {
		if (intent.type === "save" && this.options.persistence?.writable === false) return;
		const wasNumber = this.model.page.kind === "number";
		const statusCount = this.model.page.kind === "help" ? this.helpLines().length
			: intent.type === "move" && this.view.extensionStatusIndex !== undefined
				? extensionStatusEntries(this.options.getExtensionStatuses?.()).length : 0;
		const result = updatePaneModel(this.model, intent, statusCount);
		this.model = result.model;
		this.view = createPaneViewModel(this.model);
		if (result.completion) {
			if (result.completion.action === "save" && this.options.commit) {
				void this.save(result.completion);
				return;
			}
			this.dispose();
			this.done(result.completion);
			return;
		}
		if (this.model.page.kind === "number" && !wasNumber) {
			this.input = new Input();
			this.input.handleInput(`\x1b[200~${this.model.page.text}\x1b[201~`);
			this.replaceNumberOnType = true;
		}
		this.input.focused = this.hasFocus && this.model.page.kind === "number";
		this.clock.sync();
		this.requestRender();
	}
	handleInput(data: string): void {
		if (this.disposed) return;
		// A paste belongs to the page where it began; payload is never a command.
		if (this.pasteTarget || data.includes("\x1b[200~")) {
			this.pasteTarget ??= !this.saving && (this.model.page.kind === "number" || this.model.page.kind === "shortcut")
				? this.model.page.kind : "ignore";
			const end = data.indexOf("\x1b[201~");
			const length = end < 0 ? data.length : end + 6;
			if (this.pasteTarget === "number") this.editNumber(data.slice(0, length));
			else if (this.pasteTarget === "shortcut") this.dispatch({ type: "shortcut", error: "Press a shortcut; pasted text cannot be bound." });
			if (end >= 0) this.pasteTarget = undefined;
			if (length < data.length) this.handleInput(data.slice(length));
			return;
		}
		if (this.saving) {
			if (matchesKey(data, Key.ctrl("c"))) this.dispatch({ type: "cancel" });
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
		const intent = this.bindings().input(data);
		// Text entry owns every key except its effective confirm/cancel bindings.
		if (this.model.page.kind === "number" && !intent) this.editNumber(data);
		else if (intent) this.dispatch(intent);
	}

	private fg(tone: "accent" | "muted" | "dim" | "warning" | "success", text: string): string {
		return this.theme.fg(tone, text);
	}
	private renderPreview(view: GlancePaneViewModel, width: number, extensionStatuses: ReadonlyMap<string, string> | undefined): string[] {
		const config = view.preview.config;
		const scene = view.preview.activity;
		const cancelKey = this.keybindings?.getKeys?.("app.interrupt")?.[0] ?? "escape";
		const cancel = cancelKey === "escape" ? "esc" : cancelKey;
		const labels = { working: "Working", compaction: "Compacting", branchSummary: "Summarizing", retry: "Retrying", idle: "Idle with draft" };
		const messages = {
			working: "◌ Working...", compaction: `◌ Compacting context... (${cancel} to cancel)`,
			branchSummary: `◌ Summarizing branch... (${cancel} to cancel)`, retry: `◌ Retrying (2/3) in 8s... (${cancel} to cancel)`,
		};
		const selected = view.rows.find(row => row.selected);
		let contentLines = ["Your next prompt…"];
		let hasDraft = scene !== undefined;
		if (view.section === "input" && selected?.id === "input.stash") {
			contentLines = [config.editor.stashEnabled ? "Example draft · ready to stash" : "Example draft · stash is off"];
			hasDraft = config.editor.stashEnabled;
		} else if (view.section === "input" && selected?.id === "input.shortcut") {
			contentLines = [`Example shortcut · ${shortcutLabel(config.editor.stashShortcut)}`];
			hasDraft = config.editor.stashEnabled;
		}
		const options = {
			...this.options.renderStyleContext,
			...(view.preview.ambientTone ? { ambientTone: view.preview.ambientTone } : {}),
			...(view.preview.density === "auto" ? {} : { previewDensity: view.preview.density }),
			extensionStatuses,
			activity: scene && scene !== "idle" ? { kind: scene, render: () => messages[scene] } : undefined,
			animation: this.clock.frame(),
			hasDraft,
			contentLines,
			focused: true,
		};
		const preview = this.renderSurface(config, width, options);
		if (!config.enabled)
			return fitRows(["Preview · Glance is off", "Turn Glance on to preview the editor."]
				.map(text => this.fg("dim", truncateStyledText(text, width))), preview.length + 1);
		const densityLabel = view.preview.density[0]!.toUpperCase() + view.preview.density.slice(1);
		const motion = activityMotion(config, scene === "idle" ? undefined : scene);
		const rate = motion ? motion.kind === "sweep" ? ` · ${Number(motion.rate.toFixed(2))} cols/s` : ` · ${motion.rate.toFixed(2)} Hz` : "";
		const paletteLabel = view.preview.ambientTone ? `${view.preview.ambientTone[0]!.toUpperCase()}${view.preview.ambientTone.slice(1)} palette` : undefined;
		const label = scene
			? `Preview · Example · ${config.editor.activityMode === "text" ? "Text" : "Sweep"} · ${labels[scene]}${rate}`
			: paletteLabel
				? `Preview · ${paletteLabel} · ${this.previewSource}`
				: view.section === "status" ? `Preview · ${densityLabel} · ${this.previewSource}` : `Preview · ${this.previewSource}`;
		return [this.fg("dim", truncateStyledText(label, width)), ...preview];
	}
	private renderRow(row: GlancePaneViewModel["rows"][number], width: number): string {
		const mark = row.selected ? "› " : "  ";
		const value =
			row.kind === "number"
				? `‹ ${row.value} ›`
				: row.value + (row.kind === "theme" || row.kind === "choice" || row.kind === "segment" || row.kind === "shortcut" ? "  ›" : "");
		const left = mark + row.label + (row.changed ? " *" : "");
		const tone = row.selected ? "accent" : row.inactive || row.value === "Off" ? "dim" : "muted";
		const rendered = this.fg(tone, spread(left, value, width));
		return row.selected ? (this.theme.bg?.("selectedBg", rendered) ?? rendered) : rendered;
	}
	render(availableWidth: number): string[] {
		const previewWidth = Math.max(0, Math.floor(availableWidth));
		const width = Math.min(100, previewWidth);
		const indent = " ".repeat(Math.floor((previewWidth - width) / 2));
		const settingsLine = (line: string) => indent + truncateStyledText(line, width);
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
				this.fg(view.dirty ? "warning" : "dim", this.saving ? "Saving…" : this.options.persistence?.writable === false ? "Read-only" : view.dirty ? `Unsaved changes · ${view.changeCount}` : this.options.persistence?.notice ?? "No changes"),
				width,
			),
			tabs,
		];
		const priorities: Partial<Record<HelpShortcut["key"], number>> = { "↑↓": 0, "←→": 1, Enter: 2, P: 3, D: 3, "J/K": 4, Space: 5, "Tab/Shift+Tab": 6 };
		const includeTitle = view.page !== "list" || view.title.includes(" / ");
		const normalBase = header.length + 2 + HINT_ROWS + SHORTCUT_ROWS;
		const compact = height < normalBase + 4;
		const bindings = this.bindings();
		const help = (this.saving ? [] : [...view.help]).sort((a, b) => (priorities[a.key] ?? 9) - (priorities[b.key] ?? 9))
			.map((item) => bindings.format(item)).filter(Boolean);
		const footer = wrapShortcuts(help, Math.max(1, width))
			.slice(0, 2)
			.map((line) => this.fg("dim", line));
		const actionHints: HelpShortcut[] = this.saving ? [{ key: "Ctrl+C", label: "Close" }] : view.actions;
		const actions = actionHints.filter(item => item.key !== "S" || this.options.persistence?.writable !== false)
			.map((item) => this.shortcut(item)).filter(Boolean);
		footer.push(
			...wrapShortcuts(actions, Math.max(1, width))
				.slice(0, 2)
				.map((line) => this.fg("accent", line)),
		);
		const hintRows = compact ? (height >= 7 ? 1 : 0) : HINT_ROWS;
		const shortcutRows = compact ? (height >= 7 ? 2 : 1) : SHORTCUT_ROWS;
		const gapRows = compact ? 0 : 1;
		const hiddenNoticeRows = height >= 7 ? 1 : 0;
		const hint = wrapTextWithAnsi(
			this.fg(this.saveError || this.model.page.kind === "number" && this.model.page.error || this.model.page.kind === "shortcut" && this.model.page.error ? "warning" : "dim",
				this.saving ? "Saving settings. Ctrl+C closes this pane; a write already started may finish." : this.saveError || (view.page === "list" && this.options.persistence?.writable === false
					? this.options.persistence.diagnostic ?? "Read-only configuration. Fix or remove the file, then /reload."
					: view.hint)),
			Math.max(1, width),
		).slice(0, HINT_ROWS);
		const statusSource = this.options.getExtensionStatuses?.();
		let preview = this.renderPreview(view, previewWidth, statusSource);
		const title = this.fg("muted", view.title);
		const details = view.extensionStatusIndex === undefined ? undefined : extensionStatusEntries(statusSource);
		const showPreview = height - normalBase - preview.length >= 4;
		if (showPreview !== this.previewVisible) {
			this.previewVisible = showPreview;
			this.clock.sync();
			if (showPreview) preview = this.renderPreview(view, previewWidth, statusSource);
		}
		const prefix = compact
			? (height >= 7 ? [header[0]!, includeTitle ? title : ""] : [])
			: [...header, includeTitle ? title : ""];
		const hiddenNotice = !showPreview && hiddenNoticeRows ? [this.fg("dim", "Preview hidden · terminal too short")] : [];
		if (!showPreview) preview = [];
		if (compact) {
			const important = [...actionHints].sort((a, b) => {
				const priority = (key: HelpShortcut["key"]) => key === "Esc" || key === "Ctrl+C" ? 0 : key === "Enter" ? 1 : key === "?" ? 2 : key === "S" ? 3 : 4;
				return priority(a.key) - priority(b.key);
			}).filter(item => item.key !== "S" || this.options.persistence?.writable !== false);
			const selected: string[] = [];
			for (const item of important) {
				const text = bindings.format({ ...item, label: item.key === "S" ? "Save" : item.label });
				if (text && wrapShortcuts([...selected, text], Math.max(1, width)).length <= shortcutRows) selected.push(text);
			}
			footer.splice(0, footer.length, ...wrapShortcuts(selected, Math.max(1, width)).map(line => this.fg("accent", line)));
		}
		const base = prefix.length + hintRows + shortcutRows + gapRows + hiddenNotice.length;
		const budget = Math.max(1, Math.min(LIST_ROWS + 1, height - base - preview.length));
		const body: string[] = [];
		if (details) {
			if (details.length === 0) body.push(this.fg("dim", statusSource === undefined
				? "No extension publisher is attached."
				: "No extension statuses yet · publishers use setStatus()."));
			const count = Math.max(1, Math.min(LIST_ROWS, budget - (details.length > budget ? 1 : 0)));
			this.pageSize = count;
			const selected = Math.min(view.extensionStatusIndex!, Math.max(0, details.length - 1));
			const { start, end } = viewport(details.length, selected, count);
			for (const [index, entry] of details.slice(start, end).entries()) {
				const label = `${start + index === selected ? "› " : "  "}${entry.key}: `;
				body.push(this.fg("muted", label) + entry.text + EXTENSION_STATUS_RESET);
			}
			if (start > 0 || end < details.length) body.push(this.fg("dim", `${start + 1}–${end} of ${details.length}`));
		} else if (view.page === "help" && this.model.page.kind === "help") {
			const reference = this.helpLines();
			const count = Math.max(1, Math.min(LIST_ROWS, budget - (reference.length > budget ? 1 : 0)));
			this.pageSize = count;
			const selected = this.model.page.index;
			const { start, end } = viewport(reference.length, selected, count);
			body.push(...reference.slice(start, end).map((line, index) => this.fg(start + index === selected ? "accent" : "muted",
				`${start + index === selected ? "› " : "  "}${line}`)));
			if (start > 0 || end < reference.length) body.push(this.fg("dim", `${start + 1}–${end} of ${reference.length}`));
		} else if (view.page === "shortcut" && this.model.page.kind === "shortcut") {
			body.push(this.fg("accent", shortcutLabel(this.model.page.key)));
		} else if (view.page === "number") {
			body.push(...this.input.render(Math.max(1, width)));
		} else if (view.page !== "list") {
			this.pageSize = Math.max(1, Math.min(LIST_ROWS, budget - 1));
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
			const count = Math.max(1, Math.min(LIST_ROWS, budget - (view.rows.length > budget ? 1 : 0)));
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
		let lines = [...prefix, ...fitRows(body, budget), ...fitRows([], gapRows), ...fitRows(hint, hintRows),
			...fitRows(footer, shortcutRows), ...hiddenNotice];
		// At tiny heights keep the selected setting and an exit hint, not a clipped header.
		if (lines.length + preview.length > height) {
			const selected = view.rows.find((row) => row.selected);
			const confirm = view.help.find((item) => item.key === "Enter") ?? view.actions[0]!;
			const cancel = view.actions.find((item) => item.key === "Esc")!;
			lines = [
				view.page === "list" && selected ? this.renderRow(selected, width) : (body[0] ?? title),
				this.fg("dim", `${this.shortcut(confirm)}  ${this.shortcut(cancel)}`),
			].slice(0, height);
		}
		// Only controls are width-bounded. The preview stays full-width at Pi's input-area bottom.
		return [...lines.map(settingsLine), ...preview];
	}
}

interface GlancePaneUI {
	custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) => Component,
		options?: Parameters<ExtensionUIContext["custom"]>[1],
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
		}, {
			overlay: true,
			overlayOptions: { width: "100%", anchor: "bottom-left", margin: { bottom: 0 } },
		});
	} finally {
		pane?.dispose();
	}
}
