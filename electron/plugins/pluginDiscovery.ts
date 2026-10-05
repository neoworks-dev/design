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
import type {
	DiscoveredPlugin,
	PluginList,
	PluginReloadMessage,
	PluginSourceKind,
	ProjectTrust
} from '../bridge';
import { isValidPluginId, pluginTemplateFiles } from '../../src/lib/plugins/templates';
import type { SenderHandle, WindowHandle } from '../kernel/host';
import { IpcError, emitTo, route } from '../kernel/route';

export const TRUST_FILE = 'plugin-trust.json';
export const MANIFEST_FILE = 'manifest.json';
const PROJECT_PLUGIN_PATH = ['.design', 'plugins'];
const RESCAN_DELAY_MS = 150;
/** Changes this soon after a plugin's build finished are the build's own output. */
const BUILD_QUIET_MS = 800;
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

/** The id a plugin's manifest declares, or `null` when it has none that is usable. */
export function manifestId(plugin: DiscoveredPlugin): string | null {
	if (typeof plugin.manifest !== 'object' || plugin.manifest === null) return null;
	const id: unknown = Reflect.get(plugin.manifest, 'id');
	if (typeof id !== 'string') return null;
	return id;
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** The manifest's `build` command, when it names one. */
function buildCommandOf(plugin: DiscoveredPlugin): string | null {
	if (typeof plugin.manifest !== 'object' || plugin.manifest === null) return null;
	const build: unknown = Reflect.get(plugin.manifest, 'build');
	if (typeof build !== 'string' || build.trim() === '') return null;
	return build;
}

/** The directory name an installed plugin gets: the folder or archive name, made safe. */
export function installName(source: string): string {
	const base = path.basename(source).replace(/\.zip$/i, '');
	const safe = base.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '');
	if (safe === '') throw new IpcError('HANDLER_FAILED', `"${source}" cannot be installed`);
	return safe;
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
	private readonly changedPlugins = new Map<
		string,
		{ source: PluginSourceKind; directoryName: string }
	>();
	private readonly buildingUntil = new Map<string, number>();
	private readonly building = new Set<string>();

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

	/** The plugin of the sender's window whose manifest declares `pluginId`; the first root wins. */
	async findById(sender: SenderHandle, pluginId: string): Promise<DiscoveredPlugin> {
		const list = await this.list(sender);
		const found = list.plugins.find((plugin) => manifestId(plugin) === pluginId);
		if (found === undefined) throw new IpcError('HANDLER_FAILED', `no plugin "${pluginId}"`);
		return found;
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
			() =>
				this.ctx.electron.pluginFiles.watch(directory, (relative) =>
					this.noteChange('project', relative)
				),
			`plugins:watch project ${directory}`
		);
		this.projectWatchers.set(sender.id, { directory, stop });
	}

	/**
	 * A file of a plugin changed: rescan, and reload the plugin once the burst of events is over
	 * (after its `build` command, when it has one). Changes a build makes itself are ignored.
	 */
	noteChange(source: PluginSourceKind, relativePath: string): void {
		const [directoryName] = relativePath.split(/[\\/]/);
		if (directoryName !== '' && source !== 'builtin') {
			const key = `${source}/${directoryName}`;
			const quiet = this.buildingUntil.get(key);
			const ignored = this.building.has(key) || (quiet !== undefined && Date.now() < quiet);
			if (!ignored) this.changedPlugins.set(key, { source, directoryName });
		}
		this.scheduleRescan();
	}

	private async reloadChanged(): Promise<void> {
		const changed = [...this.changedPlugins.values()];
		this.changedPlugins.clear();
		for (const entry of changed) await this.reloadPlugin(entry.source, entry.directoryName);
	}

	private async reloadPlugin(source: PluginSourceKind, directoryName: string): Promise<void> {
		const key = `${source}/${directoryName}`;
		const targets: { window: WindowHandle; plugin: DiscoveredPlugin }[] = [];
		for (const window of this.ctx.electron.windows()) {
			if (window.isDestroyed()) continue;
			const list = await this.list(window.sender);
			const plugin = list.plugins.find(
				(candidate) => candidate.source === source && candidate.directoryName === directoryName
			);
			if (plugin !== undefined && plugin.trusted && plugin.manifest !== null) {
				targets.push({ window, plugin });
			}
		}
		if (targets.length === 0) return;
		const message: PluginReloadMessage = { source, directoryName };
		const command = buildCommandOf(targets[0].plugin);
		if (command !== null) {
			this.building.add(key);
			try {
				message.build = await this.ctx.electron.pluginFiles.runBuild(
					targets[0].plugin.directory,
					command
				);
			} finally {
				this.building.delete(key);
				this.buildingUntil.set(key, Date.now() + BUILD_QUIET_MS);
			}
		}
		for (const target of targets) emitTo(target.window, 'plugins:reload', message);
	}

	/** Coalesce bursts of file events (an editor saving, a build writing several files). */
	scheduleRescan(): void {
		void this.rescanTimer?.();
		this.rescanTimer = this.ctx.effect(() => {
			const handle = setTimeout(() => {
				this.rescanTimer = null;
				this.refreshAll()
					.then(() => this.reloadChanged())
					.catch((error: unknown) => this.ctx.logger.error(error));
			}, RESCAN_DELAY_MS);
			return () => clearTimeout(handle);
		}, 'plugins:rescan');
	}

	// ---------- installing and removing ----------

	/** Copy a plugin folder, or unpack a `.zip`, into the user plugins directory. */
	async install(sender: SenderHandle, source: string): Promise<PluginList> {
		const name = installName(source);
		const destination = path.join(this.userDirectory, name);
		await this.ctx.electron.pluginFiles.ensureDirectory(this.userDirectory);
		const installed = await this.ctx.electron.pluginFiles.listDirectories(this.userDirectory);
		if (installed.includes(name)) {
			throw new IpcError('HANDLER_FAILED', `a plugin folder named "${name}" is already installed`);
		}
		try {
			await this.ctx.electron.pluginFiles.install(source, destination);
			const manifest = await this.ctx.electron.pluginFiles.readText(
				path.join(destination, MANIFEST_FILE)
			);
			if (manifest === undefined) {
				throw new IpcError('HANDLER_FAILED', `"${path.basename(source)}" has no manifest.json`);
			}
		} catch (error) {
			await this.ctx.electron.pluginFiles.remove(destination);
			if (error instanceof IpcError) throw error;
			throw new IpcError('HANDLER_FAILED', `could not install: ${describeError(error)}`);
		}
		const list = await this.list(sender);
		this.publish(sender, list);
		return list;
	}

	/** Pick a folder or a `.zip` with a native dialog and install it; `null` when cancelled. */
	async installFromDialog(
		sender: SenderHandle,
		kind: 'folder' | 'zip'
	): Promise<PluginList | null> {
		const picked = await this.ctx.electron.dialog.showOpenDialog({
			title: kind === 'folder' ? 'Install plugin from folder' : 'Install plugin from .zip',
			multiple: false,
			directory: kind === 'folder',
			filters: kind === 'zip' ? [{ name: 'Plugin archive', extensions: ['zip'] }] : undefined
		});
		if (picked === null || picked.length === 0) return null;
		return this.install(sender, picked[0]);
	}

	/** Write a new plugin from a template into the user plugins directory. */
	async create(
		sender: SenderHandle,
		id: string,
		name: string,
		template: 'blank' | 'panel' | 'figma'
	): Promise<PluginList> {
		if (!isValidPluginId(id)) throw new IpcError('INVALID_PAYLOAD', `"${id}" is not a valid id`);
		const files = this.ctx.electron.pluginFiles;
		await files.ensureDirectory(this.userDirectory);
		if ((await files.listDirectories(this.userDirectory)).includes(id)) {
			throw new IpcError('HANDLER_FAILED', `a plugin folder named "${id}" already exists`);
		}
		const destination = path.join(this.userDirectory, id);
		for (const [relative, text] of Object.entries(pluginTemplateFiles(template, id, name))) {
			await files.writeText(path.join(destination, relative), text);
		}
		const list = await this.list(sender);
		this.publish(sender, list);
		return list;
	}

	/** Delete a plugin of the user plugins directory (bundled and project plugins are not ours to delete). */
	async remove(sender: SenderHandle, directoryName: string): Promise<PluginList> {
		const directory = path.join(this.userDirectory, directoryName);
		if (!isInside(this.userDirectory, directory) || directory === this.userDirectory) {
			throw new IpcError('HANDLER_FAILED', `"${directoryName}" is not an installed plugin`);
		}
		await this.ctx.electron.pluginFiles.remove(directory);
		const list = await this.list(sender);
		this.publish(sender, list);
		return list;
	}

	async reveal(
		sender: SenderHandle,
		source: PluginSourceKind,
		directoryName: string
	): Promise<void> {
		const list = await this.list(sender);
		const plugin = list.plugins.find(
			(candidate) => candidate.source === source && candidate.directoryName === directoryName
		);
		if (!plugin) throw new IpcError('HANDLER_FAILED', `no ${source} plugin "${directoryName}"`);
		this.ctx.electron.shell.showItemInFolder(path.join(plugin.directory, MANIFEST_FILE));
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
		route(ctx, 'plugins:install', (request, event) =>
			discovery.install(event.sender, request.path)
		);
		route(ctx, 'plugins:installFromDialog', (request, event) =>
			discovery.installFromDialog(event.sender, request.kind)
		);
		route(ctx, 'plugins:create', (request, event) =>
			discovery.create(event.sender, request.id, request.name, request.template)
		);
		route(ctx, 'plugins:remove', (request, event) =>
			discovery.remove(event.sender, request.directoryName)
		);
		route(ctx, 'plugins:reveal', (request, event) =>
			discovery.reveal(event.sender, request.source, request.directoryName)
		);
		route(ctx, 'plugins:readFile', (request, event) =>
			discovery.readFile(event.sender, request.source, request.directoryName, request.file)
		);

		// The user directory is where people drop plugins in: make sure it exists to be watched.
		ctx.effect(async () => {
			await ctx.electron.pluginFiles.ensureDirectory(discovery.userDirectory);
			return () => {};
		}, 'plugins:user directory');
		const roots: [PluginSourceKind, string][] = [
			['builtin', discovery.bundledDirectory],
			['user', discovery.userDirectory]
		];
		for (const [source, directory] of roots) {
			ctx.effect(
				() =>
					ctx.electron.pluginFiles.watch(directory, (relative) =>
						discovery.noteChange(source, relative)
					),
				`plugins:watch ${source}`
			);
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
