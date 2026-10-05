// The `errorUi` service (#141): what the user sees when something breaks. The boot report dialog
// (failed and pending plugins, retry, disable), toasts for errors that happen later, the log
// viewer, "copy diagnostics" and the safe mode restart.
//
// A broken plugin never blanks the app (boot uses allSettled, every contribution sits in an error
// boundary); this service is the place where the failure becomes visible and actionable.

import { Service, type Context } from '@neoworks/extension-system';
import type { DiagnosticsReport } from '../../../electron/bridge';
import type { BootReport } from '../kernel/boot.svelte';
import { readDisabledPlugins, writeDisabledPlugins } from '../kernel/startup';
import type { ErrorUiState, ErrorUiTab, LogSource, Toast } from './errorUiState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		errorUi: ErrorUiService;
	}
}

/** The part of the `desktop` service this one uses. */
export interface ErrorUiDesktop {
	diagnostics(): Promise<DiagnosticsReport>;
	restartWindow(safeMode: boolean): Promise<void>;
	clipboardWrite(content: { text: string }): Promise<void>;
}

export interface ErrorUiStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export class ErrorUiService extends Service {
	private nextToastId = 1;
	private readonly announced = new Set<string>();

	constructor(
		ctx: Context,
		private readonly desktop: ErrorUiDesktop,
		private readonly state: ErrorUiState,
		private readonly storage: ErrorUiStorage | undefined
	) {
		super(ctx, 'errorUi');
		this.state.disabledNames = [...readDisabledPlugins(storage)].sort();
	}

	// ---------- reads (reactive) ----------

	get report(): BootReport | null {
		return this.state.report;
	}
	get isOpen(): boolean {
		return this.state.isOpen;
	}
	get tab(): ErrorUiTab {
		return this.state.tab;
	}
	get logSource(): LogSource {
		return this.state.logSource;
	}
	get toasts(): readonly Toast[] {
		return this.state.toasts;
	}
	get status(): string {
		return this.state.status;
	}
	get diagnostics(): ErrorUiState['diagnostics'] {
		return this.state.diagnostics;
	}
	get disabledNames(): readonly string[] {
		return this.state.disabledNames;
	}
	get safeMode(): boolean {
		return new URLSearchParams(location.search).get('safe') === '1';
	}

	/** The lines of the chosen log, newest last. */
	get logLines(): string[] {
		const { diagnostics, logSource } = this.state;
		if (diagnostics === null) return [];
		return diagnostics[logSource];
	}

	/** Failed plus pending plugins: what the dialog exists for. */
	get problemCount(): number {
		const { report } = this.state;
		if (report === null) return 0;
		return report.failures.length + report.pending.length;
	}

	// ---------- boot report ----------

	/** Take the finished boot's report. A boot with failures opens the dialog by itself. */
	attachReport(report: BootReport): void {
		this.state.report = report;
		for (const failure of report.failures) this.announced.add(failure.name);
		if (report.failures.length > 0) this.open('plugins');
		if (this.safeMode) {
			this.toast('Safe mode: only the core plugins are running.', 'info');
		}
	}

	/** Toast every plugin that failed after boot (a retry that failed again counts once). */
	announceNewFailures(): void {
		const { report } = this.state;
		if (report === null) return;
		for (const failure of report.failures) {
			if (this.announced.has(failure.name)) continue;
			this.announced.add(failure.name);
			this.toast(`Plugin "${failure.name}" failed: ${failure.error}`, 'error');
		}
	}

	async retry(name: string): Promise<void> {
		const { report } = this.state;
		if (report === null) return;
		this.announced.delete(name);
		await report.retryPlugin(name);
		this.announced.add(name);
	}

	async disable(name: string): Promise<void> {
		const { report } = this.state;
		if (report === null) return;
		await report.disablePlugin(name);
		this.persistDisabled([...new Set([...this.state.disabledNames, name])]);
	}

	/** Takes effect at the next start: a disabled plugin is not mounted at boot. */
	enable(name: string): void {
		this.persistDisabled(this.state.disabledNames.filter((disabled) => disabled !== name));
		this.state.status = `"${name}" will load at the next start.`;
	}

	private persistDisabled(names: string[]): void {
		this.state.disabledNames = names.sort();
		writeDisabledPlugins(this.storage, new Set(names));
	}

	// ---------- dialog ----------

	open(tab: ErrorUiTab = 'plugins'): void {
		this.state.status = '';
		this.state.isOpen = true;
		this.setTab(tab);
	}

	close(): void {
		this.state.isOpen = false;
	}

	toggle(): void {
		if (this.state.isOpen) this.close();
		else this.open();
	}

	setTab(tab: ErrorUiTab): void {
		this.state.tab = tab;
		if (tab === 'logs') void this.refreshLogs();
	}

	setLogSource(source: LogSource): void {
		this.state.logSource = source;
	}

	async refreshLogs(): Promise<void> {
		try {
			this.state.diagnostics = await this.desktop.diagnostics();
		} catch (error) {
			this.state.status = `Could not read the logs: ${messageOf(error)}`;
		}
	}

	// ---------- diagnostics ----------

	/** A plain-text report for a bug report: versions, plugin states and the newest log lines. */
	async diagnosticsText(): Promise<string> {
		const diagnostics = await this.desktop.diagnostics();
		const lines = [
			'# Diagnostics',
			`app ${diagnostics.app.version}, electron ${diagnostics.app.electron}, chrome ${diagnostics.app.chrome}`,
			`${diagnostics.app.platform} ${diagnostics.app.arch}, safe mode: ${diagnostics.app.safeMode}`,
			'',
			'## Plugins'
		];
		const { report } = this.state;
		if (report !== null) {
			for (const record of report.records) {
				if (record.status === 'active') continue;
				lines.push(`${record.status} ${record.name}`);
				if (record.error !== undefined) lines[lines.length - 1] += `: ${record.error}`;
			}
			lines.push(`${report.records.filter((record) => record.status === 'active').length} active`);
		}
		lines.push(
			'',
			'## Main log',
			...diagnostics.main,
			'',
			'## Renderer log',
			...diagnostics.renderer
		);
		return lines.join('\n');
	}

	async copyDiagnostics(): Promise<void> {
		try {
			await this.desktop.clipboardWrite({ text: await this.diagnosticsText() });
			this.state.status = 'Diagnostics copied to the clipboard.';
		} catch (error) {
			this.state.status = `Could not copy diagnostics: ${messageOf(error)}`;
		}
	}

	/** Reload the window with only the core plugins (or normally). Edits are already saved. */
	async restart(safeMode: boolean): Promise<void> {
		try {
			await this.desktop.restartWindow(safeMode);
		} catch (error) {
			this.state.status = `Could not restart: ${messageOf(error)}`;
		}
	}

	// ---------- toasts ----------

	toast(message: string, kind: Toast['kind'] = 'error'): void {
		const last = this.state.toasts[this.state.toasts.length - 1];
		if (last !== undefined && last.message === message && last.kind === kind) return;
		const toast: Toast = { id: this.nextToastId, kind, message };
		this.nextToastId += 1;
		this.state.toasts = [...this.state.toasts, toast].slice(-4);
	}

	dismissToast(id: number): void {
		this.state.toasts = this.state.toasts.filter((toast) => toast.id !== id);
	}

	snapshotState(): Record<string, unknown> {
		return { open: this.state.isOpen, toasts: this.state.toasts.length };
	}
}

function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
