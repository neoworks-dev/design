// main-plugins: finds third-party plugins on disk and tells the renderer about them
// (docs/research/plugin-api.md section 3).
//
// Three roots, in precedence order: `plugins/` bundled with the app, `plugins/` in the user data
// directory, and `<project>/.design/plugins/` next to the window's open document. Every
// subdirectory of a root with a `manifest.json` is a plugin; main only parses the JSON, the
// renderer's `plugin-manifests` plugin validates it against the schema.
//
// Project plugins are code from a file somebody shared with the user, so they need the user's
// say-so per project. Until then they are listed with `trusted: false` and `plugins:readFile`
// refuses them, so the renderer never starts them. The decision is stored in `plugin-trust.json`
// in the user data directory.
//
// The roots are watched; every change (and every document switch) re-sends `plugins:changed` to
// the windows whose list differs from what they last got. Watchers close with the plugin.

import path from 'node:path';
import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import { z } from 'zod';
import type { DiscoveredPlugin, PluginList, PluginSourceKind, ProjectTrust } from '../bridge';
import type { SenderHandle } from '../kernel/host';
import { IpcError, emitTo, route } from '../kernel/route';

export const TRUST_FILE = 'plugin-trust.json';
export const MANIFEST_FILE = 'manifest.json';
const PROJECT_PLUGIN_PATH = ['.design', 'plugins'];
const RESCAN_DELAY_MS = 150;
/** A plugin's main module is source code; more than this is a mistake, not a plugin. */
const MAX_PLUGIN_FILE_BYTES = 8 * 1024 * 1024;

const trustFileSchema = z.object({ projects: z.record(z.string(), z.boolean()) });

export const pluginDiscoveryConfigSchema = z.strictObject({
	/** The `plugins/` directory bundled with the app. */
	bundledDirectory: z.string()
});
export type PluginDiscoveryConfig = z.infer<typeof pluginDiscoveryConfigSchema>;

export function parseTrustFile(text: string | undefined): Record<string, boolean> {
	if (text === undefined) return {};
	try {
		const parsed = trustFileSchema.safeParse(JSON.parse(text));
		if (!parsed.success) return {};
		return parsed.data.projects;
	} catch {
		return {};
	}
}

function parseJson(text: string): unknown {
	return JSON.parse(text);
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** True when `candidate` is `directory` itself or below it, after resolving `..` segments. */
export function isInside(directory: string, candidate: string): boolean {
	const relative = path.relative(directory, candidate);
	if (relative === '') return true;
	if (relative.startsWith('..')) return false;
	return !path.isAbsolute(relative);
}

export class PluginDiscoveryService extends Service {
	/** Decisions by project directory; read once, written on every change. */
	private decisions: Record<string, boolean> | null = null;
	private readonly lastSent = new Map<number, string>();
	private readonly projectWatchers = new Map<number, { directory: string; stop: () => unknown }>();
	private readonly asked = new Set<string>();
	private rescanTimer: (() => unknown) | null = null;

	constructor(
		ctx: Context,
		private readonly config: PluginDiscoveryConfig
	) {
		super(ctx, 'pluginDiscovery');
	}

	get userDirectory(): string {
		return path.join(this.ctx.electron.app.getPath('userData'), 'plugins');
	}

	get bundledDirectory(): string {
		return this.config.bundledDirectory;
	}

	projectPluginDirectory(projectDirectory: string): string {
		return path.join(projectDirectory, ...PROJECT_PLUGIN_PATH);
	}

	// ---------- scanning ----------

	/** The plugins of the three roots as the sender's window sees them. */
	async list(sender: SenderHandle): Promise<PluginList> {
		const project = this.ctx.store.projectDirectory(sender);
		const plugins = [
			...(await this.scanRoot('builtin', this.bundledDirectory, true)),
			...(await this.scanRoot('user', this.userDirectory, true))
		];
		if (project === null) return { plugins, project: null, projectTrust: null };
		const trust = this.trustOf(project);
		const trusted = trust === 'trusted';
		const projectPlugins = await this.scanRoot(
			'project',
			this.projectPluginDirectory(project),
			trusted
		);
		return { plugins: [...plugins, ...projectPlugins], project, projectTrust: trust };
	}

	private async scanRoot(
		source: PluginSourceKind,
		directory: string,
		trusted: boolean
	): Promise<DiscoveredPlugin[]> {
		const names = await this.ctx.electron.pluginFiles.listDirectories(directory);
		const found: DiscoveredPlugin[] = [];
		for (const directoryName of names) {
			found.push(await this.readPlugin(source, directory, directoryName, trusted));
		}
		return found;
	}

	private async readPlugin(
		source: PluginSourceKind,
		root: string,
		directoryName: string,
		trusted: boolean
	): Promise<DiscoveredPlugin> {
		const directory = path.join(root, directoryName);
		const base = { source, directoryName, directory, trusted };
		const text = await this.ctx.electron.pluginFiles.readText(path.join(directory, MANIFEST_FILE));
		if (text === undefined) return { ...base, manifest: null, error: 'no manifest.json' };
		try {
			return { ...base, manifest: parseJson(text) };
		} catch (error) {
			return {
				...base,
				manifest: null,
				error: `manifest.json is not valid JSON: ${describeError(error)}`
			};
		}
	}

	// ---------- trust ----------

	private loadDecisions(): Record<string, boolean> {
		if (this.decisions === null) {
			this.decisions = parseTrustFile(this.ctx.electron.userData.readText(TRUST_FILE));
		}
		return this.decisions;
	}

	trustOf(project: string): ProjectTrust {
		const decision = this.loadDecisions()[project];
		if (decision === undefined) return 'undecided';
		if (decision) return 'trusted';
		return 'untrusted';
	}

	setTrust(project: string, trusted: boolean): void {
		const decisions = { ...this.loadDecisions(), [project]: trusted };
		this.decisions = decisions;
		this.ctx.electron.userData.writeText(
			TRUST_FILE,
			JSON.stringify({ projects: decisions }, null, '\t')
		);
	}

	async setTrustFor(sender: SenderHandle, trusted: boolean): Promise<PluginList> {
		const project = this.ctx.store.projectDirectory(sender);
		if (project === null) {
			throw new IpcError('HANDLER_FAILED', 'this window has no saved document, so no project');
		}
		this.setTrust(project, trusted);
		this.asked.add(project);
		const list = await this.list(sender);
		this.publish(sender, list);
		return list;
	}

	/**
	 * Ask once per project and session whether to trust it, when it holds plugins and no decision
	 * was stored yet. The list is sent first (untrusted), the answer sends it again.
	 */
	private async askAboutProject(sender: SenderHandle, list: PluginList): Promise<void> {
		const { project } = list;
		if (project === null || list.projectTrust !== 'undecided' || this.asked.has(project)) return;
		const projectPlugins = list.plugins.filter((plugin) => plugin.source === 'project');
		if (projectPlugins.length === 0) return;
		this.asked.add(project);
		const names = projectPlugins.map((plugin) => plugin.directoryName).join(', ');
		const answer = await this.ctx.electron.dialog.showMessageBox({
			message: `Trust the plugins in this project?`,
			detail: `${project} contains plugins (${names}). Plugins run code with access to your document. Only trust projects from people you trust.`,
			buttons: ['Trust and load', "Don't load"],
			defaultId: 1,
			cancelId: 1
		});
		this.setTrust(project, answer === 0);
		this.publish(sender, await this.list(sender));
	}

	// ---------- pushing to windows ----------

	/** Send `list` to the sender's window unless it already has exactly this. */
	publish(sender: SenderHandle, list: PluginList): void {
		const window = this.ctx.electron.windowFromSender(sender);
		if (window === null) return;
		const signature = JSON.stringify(list);
		if (this.lastSent.get(sender.id) === signature) return;
		this.lastSent.set(sender.id, signature);
		emitTo(window, 'plugins:changed', list);
	}

	/** Re-read the roots for every open window. */
	async refreshAll(): Promise<void> {
		for (const window of this.ctx.electron.windows()) {
			if (window.isDestroyed()) continue;
			await this.refresh(window.sender);
		}
	}

	async refresh(sender: SenderHandle): Promise<void> {
		const list = await this.list(sender);
		this.publish(sender, list);
		await this.askAboutProject(sender, list);
	}

	/** The window's document changed: watch its project's plugin directory instead. */
	async handleDocumentChange(sender: SenderHandle): Promise<void> {
		this.watchProject(sender);
		if (this.ctx.electron.windowFromSender(sender) === null) {
			this.lastSent.delete(sender.id);
			return;
		}
		await this.refresh(sender);
	}

	private watchProject(sender: SenderHandle): void {
		const project = this.ctx.store.projectDirectory(sender);
		const directory = project === null ? null : this.projectPluginDirectory(project);
		const current = this.projectWatchers.get(sender.id);
		if (current && current.directory === directory) return;
		if (current) {
			current.stop();
			this.projectWatchers.delete(sender.id);
		}
		if (directory === null) return;
		const stop = this.ctx.effect(
			() => this.ctx.electron.pluginFiles.watch(directory, () => this.scheduleRescan()),
			`plugins:watch project ${directory}`
		);
		this.projectWatchers.set(sender.id, { directory, stop });
	}

	/** Coalesce bursts of file events (an editor saving, a build writing several files). */
	scheduleRescan(): void {
		void this.rescanTimer?.();
		this.rescanTimer = this.ctx.effect(() => {
			const handle = setTimeout(() => {
				this.rescanTimer = null;
				this.refreshAll().catch((error: unknown) => this.ctx.logger.error(error));
			}, RESCAN_DELAY_MS);
			return () => clearTimeout(handle);
		}, 'plugins:rescan');
	}

	// ---------- reading plugin files ----------

	async readFile(
		sender: SenderHandle,
		source: PluginSourceKind,
		directoryName: string,
		file: string
	): Promise<string> {
		const list = await this.list(sender);
		const plugin = list.plugins.find(
			(candidate) => candidate.source === source && candidate.directoryName === directoryName
		);
		if (!plugin) throw new IpcError('HANDLER_FAILED', `no ${source} plugin "${directoryName}"`);
		if (!plugin.trusted) {
			throw new IpcError('HANDLER_FAILED', `plugin "${directoryName}" is in an untrusted project`);
		}
		const target = path.resolve(plugin.directory, file);
		if (!isInside(plugin.directory, target)) {
			throw new IpcError('HANDLER_FAILED', `"${file}" is outside the plugin's directory`);
		}
		const text = await this.ctx.electron.pluginFiles.readText(target);
		if (text === undefined) throw new IpcError('HANDLER_FAILED', `no file "${file}" in the plugin`);
		if (text.length > MAX_PLUGIN_FILE_BYTES) {
			throw new IpcError('HANDLER_FAILED', `"${file}" is larger than the plugin file limit`);
		}
		return text;
	}

	snapshotState(): Record<string, unknown> {
		return {
			projectWatchers: [...this.projectWatchers.values()].map((entry) => entry.directory).sort()
		};
	}
}

declare module '@neoworks/extension-system' {
	interface Context {
		pluginDiscovery: PluginDiscoveryService;
	}
}

export const mainPluginsPlugin: Plugin.Object<PluginDiscoveryConfig> = {
	name: 'main-plugins',
	inject: ['electron', 'ipc', 'store'],
	Config: pluginDiscoveryConfigSchema,
	apply(ctx, config) {
		const discovery = new PluginDiscoveryService(ctx, config);

		route(ctx, 'plugins:list', (_payload, event) => discovery.list(event.sender));
		route(ctx, 'plugins:setTrust', (request, event) =>
			discovery.setTrustFor(event.sender, request.trusted)
		);
		route(ctx, 'plugins:readFile', (request, event) =>
			discovery.readFile(event.sender, request.source, request.directoryName, request.file)
		);

		// The user directory is where people drop plugins in: make sure it exists to be watched.
		ctx.effect(async () => {
			await ctx.electron.pluginFiles.ensureDirectory(discovery.userDirectory);
			return () => {};
		}, 'plugins:user directory');
		const rescan = (): void => discovery.scheduleRescan();
		for (const [label, directory] of [
			['bundled', discovery.bundledDirectory],
			['user', discovery.userDirectory]
		]) {
			ctx.effect(() => ctx.electron.pluginFiles.watch(directory, rescan), `plugins:watch ${label}`);
		}

		ctx.effect(
			() =>
				ctx.store.onChange((sender) => {
					discovery.handleDocumentChange(sender).catch((error: unknown) => ctx.logger.error(error));
				}),
			'plugins:follow documents'
		);
	}
};
