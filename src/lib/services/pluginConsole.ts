// The `pluginConsole` service: what plugins print, in one place, and the developer's loop around it.
// Provided by plugin `plugin-devtools`.
//
//   - lines of every plugin's console (`design.log`, errors of its code, why it failed), kept across
//     hot reloads so the output before and after an edit reads as one history
//   - stack traces of errors are mapped back to the plugin's sources when it ships `main.js.map`
//   - a plugin whose files changed on disk is rebuilt (its `build` command, run by main) and
//     restarted: the old worker and everything it registered go, the new one starts fresh

import { Service, type Context } from '@neoworks/extension-system';
import type { PluginList, PluginReloadMessage } from '../../../electron/bridge';
import { mapStackTrace, parseSourceMap, type SourceMap } from '../plugins/sourceMap';
import type { PluginHostService } from './pluginHost';
import type { ConsoleLevel, ConsoleLine, PluginConsoleState } from './pluginConsoleState.svelte';
import type { PluginRegistryService } from './pluginRegistry';
import { isValidPluginId, suggestPluginId, type PluginTemplateKind } from '../plugins/templates';

declare module '@neoworks/extension-system' {
	interface Context {
		pluginConsole: PluginConsoleService;
	}
}

/** What the console asks main for. */
export interface DevtoolsBackend {
	readSourceMap(pluginId: string): Promise<string | undefined>;
	create(id: string, name: string, template: PluginTemplateKind): Promise<PluginList>;
}

const MAX_LINES = 2000;
const STACK_MARKER = '\n    at ';

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export class PluginConsoleService extends Service {
	private readonly counter = { value: 0 };
	private readonly maps = new Map<string, Promise<SourceMap | null>>();

	constructor(
		ctx: Context,
		private readonly state: PluginConsoleState,
		private readonly registry: PluginRegistryService,
		private readonly host: PluginHostService,
		private readonly backend: DevtoolsBackend
	) {
		super(ctx, 'pluginConsole');
	}

	// ---------- reads (reactive) ----------

	get isOpen(): boolean {
		return this.state.open;
	}

	get filter(): string | null {
		return this.state.filter;
	}

	get createOpen(): boolean {
		return this.state.createOpen;
	}

	get notice(): { text: string; error: boolean } | null {
		return this.state.notice;
	}

	/** The lines to show: everything, or one plugin's. */
	lines(): ConsoleLine[] {
		const filter = this.state.filter;
		if (filter === null) return this.state.lines;
		return this.state.lines.filter((line) => line.pluginId === filter);
	}

	/** Ids that wrote something, for the filter. */
	pluginIds(): string[] {
		return [...new Set(this.state.lines.map((line) => line.pluginId))].sort();
	}

	// ---------- the console ----------

	openConsole(): void {
		this.state.open = true;
	}

	closeConsole(): void {
		this.state.open = false;
	}

	toggleConsole(): void {
		this.state.open = !this.state.open;
	}

	setFilter(pluginId: string | null): void {
		this.state.filter = pluginId;
	}

	clear(): void {
		this.state.lines = [];
	}

	append(pluginId: string, level: ConsoleLevel, message: string): void {
		this.counter.value += 1;
		const line: ConsoleLine = {
			id: this.counter.value,
			pluginId,
			level,
			message,
			at: Date.now()
		};
		this.state.lines = [...this.state.lines, line].slice(-MAX_LINES);
		if (level === 'error' && message.includes(STACK_MARKER)) void this.mapLine(line);
	}

	private async mapLine(line: ConsoleLine): Promise<void> {
		const record = this.registry.get(line.pluginId);
		if (record === undefined || record.manifest === null) return;
		const map = await this.sourceMapOf(line.pluginId);
		if (map === null) return;
		const message = mapStackTrace(line.message, map, record.manifest.main);
		if (message === line.message) return;
		this.state.lines = this.state.lines.map((entry) =>
			entry.id === line.id ? { ...entry, message } : entry
		);
	}

	private sourceMapOf(pluginId: string): Promise<SourceMap | null> {
		let map = this.maps.get(pluginId);
		if (map === undefined) {
			map = this.backend.readSourceMap(pluginId).then(
				(text) => (text === undefined ? null : parseSourceMap(text)),
				() => null
			);
			this.maps.set(pluginId, map);
		}
		return map;
	}

	// ---------- hot reload ----------

	/**
	 * Files of a plugin changed (main already ran its build command). Restart it when it runs; a
	 * failed build keeps the running version and shows the compiler output.
	 */
	async handleReload(message: PluginReloadMessage): Promise<void> {
		const record = this.registry
			.records()
			.find(
				(candidate) =>
					candidate.source === message.source && candidate.directoryName === message.directoryName
			);
		if (record === undefined || record.manifest === null) return;
		const pluginId = record.id;
		const started = Date.now();
		this.maps.delete(pluginId);
		if (message.build !== undefined) {
			if (message.build.output !== '') {
				this.append(pluginId, message.build.ok ? 'system' : 'error', message.build.output);
			}
			if (!message.build.ok) {
				this.append(pluginId, 'error', 'The build failed; the running version stays.');
				return;
			}
		}
		if (this.host.connectionOf(pluginId) === undefined && record.status !== 'failed') {
			this.append(pluginId, 'system', 'Files changed; the plugin starts fresh when used.');
			return;
		}
		try {
			await this.host.restart(pluginId);
			this.append(pluginId, 'system', `Reloaded in ${Date.now() - started} ms`);
		} catch (error) {
			this.append(pluginId, 'error', `Reload failed: ${describeError(error)}`);
		}
	}

	// ---------- create plugin ----------

	openCreate(): void {
		this.state.createOpen = true;
		this.state.notice = null;
	}

	closeCreate(): void {
		this.state.createOpen = false;
	}

	/** Write a plugin from a template into the user plugins directory and show it. */
	async create(name: string, template: PluginTemplateKind): Promise<void> {
		const id = suggestPluginId(name);
		if (!isValidPluginId(id)) {
			this.state.notice = { text: 'Give the plugin a name with letters or digits.', error: true };
			return;
		}
		try {
			await this.backend.create(id, name.trim(), template);
			this.state.createOpen = false;
			this.state.notice = null;
			this.append(id, 'system', `Created plugin "${name.trim()}" from the ${template} template`);
			this.openConsole();
		} catch (error) {
			this.state.notice = { text: describeError(error), error: true };
		}
	}

	/** Restart every running plugin (a manual reload of everything). */
	async restartAll(): Promise<void> {
		for (const connection of this.host.connections()) {
			try {
				await this.host.restart(connection.pluginId);
			} catch (error) {
				this.append(connection.pluginId, 'error', `Restart failed: ${describeError(error)}`);
			}
		}
	}

	snapshotState(): Record<string, unknown> {
		return { open: this.state.open, lines: this.state.lines.length };
	}
}
