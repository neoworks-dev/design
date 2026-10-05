// The `pluginUi` service: the declarative UI surfaces of third-party plugins. Provided by plugin
// `plugin-ui`.
//
// A plugin's worker sends trees (`ui.set`) and patches (`ui.patch`); this service validates them
// (unknown node types, oversized trees and non-inline images are refused, see lib/plugins/surface),
// keeps the latest tree per surface and renders nothing itself: components read `surface()` and
// show it. User input goes back as `dispatch`, which runs the plugin's handler as a plugin run
// (one undo step for what it changes). Surfaces belong to the worker that created them: when the
// worker stops they are removed.

import { Service, type Context } from '@neoworks/extension-system';
import type { PanelsService } from '../registries/panels.svelte';
import type { PluginConnection } from '../plugins/connection';
import {
	applySurfacePatch,
	validateSurface,
	type SurfaceNode,
	type SurfacePatch
} from '../plugins/surface';
import {
	surfaceKey,
	type SurfaceEntry,
	type SurfaceStore
} from '../plugins/ui/surfaceStore.svelte';
import type { PluginHostService } from './pluginHost';
import type { PluginRegistryService } from './pluginRegistry';

declare module '@neoworks/extension-system' {
	interface Context {
		pluginUi: PluginUiService;
	}
}

const DEFAULT_MODAL_WIDTH = 360;
const DEFAULT_MODAL_HEIGHT = 240;

export class SurfaceOutOfSyncError extends Error {
	constructor(surfaceId: string) {
		super(`surface "${surfaceId}" is out of step with the host; send the whole tree`);
		this.name = 'SurfaceOutOfSyncError';
	}
}

export class PluginUiService extends Service {
	// Which surfaces each worker created, to remove them when it stops.
	private readonly owned = new WeakMap<PluginConnection, Set<string>>();

	constructor(
		ctx: Context,
		private readonly store: SurfaceStore,
		private readonly host: PluginHostService,
		private readonly registry: PluginRegistryService,
		private readonly panels: PanelsService
	) {
		super(ctx, 'pluginUi');
	}

	// ---------- reads (reactive) ----------

	surface(pluginId: string, surfaceId: string): SurfaceEntry | undefined {
		return this.store.get(pluginId, surfaceId);
	}

	/** The modals that are open now. */
	openModals(): SurfaceEntry[] {
		return this.store.all().filter((entry) => entry.modal !== null && entry.visible);
	}

	// ---------- the worker's side ----------

	/** Replace a surface's tree. Throws a message naming the problem when the tree is not valid. */
	set(connection: PluginConnection, surfaceId: string, raw: unknown): void {
		const result = validateSurface(raw);
		if (!result.ok) throw new Error(`surface "${surfaceId}": ${result.error}`);
		const entry = this.ensure(connection, surfaceId);
		this.store.put({ ...entry, tree: result.tree, version: 1 });
	}

	/** Apply a patch built on `version - 1`; a mismatch asks the plugin to send the whole tree. */
	patch(
		connection: PluginConnection,
		surfaceId: string,
		version: number,
		ops: readonly SurfacePatch[]
	): void {
		const entry = this.store.get(connection.pluginId, surfaceId);
		if (entry === undefined || entry.tree === null || entry.version + 1 !== version) {
			throw new SurfaceOutOfSyncError(surfaceId);
		}
		let patched: SurfaceNode;
		try {
			patched = applySurfacePatch(entry.tree, ops);
		} catch {
			throw new SurfaceOutOfSyncError(surfaceId);
		}
		// A patch must not be a way around the schema or the size limits.
		const result = validateSurface(patched);
		if (!result.ok) throw new Error(`surface "${surfaceId}": ${result.error}`);
		this.store.put({ ...entry, tree: result.tree, version });
	}

	show(connection: PluginConnection, surfaceId: string): void {
		if (this.isDeclaredPanel(connection, surfaceId)) {
			this.panels.activateTab(surfaceId);
			return;
		}
		const entry = this.ensure(connection, surfaceId);
		this.store.put({ ...entry, visible: true });
	}

	hide(connection: PluginConnection, surfaceId: string): void {
		const entry = this.store.get(connection.pluginId, surfaceId);
		if (entry === undefined) return;
		this.store.put({ ...entry, visible: false });
	}

	resize(connection: PluginConnection, surfaceId: string, width: number, height: number): void {
		const entry = this.ensure(connection, surfaceId);
		const modal = entry.modal;
		if (modal === null)
			throw new Error(`surface "${surfaceId}" is not a modal, it cannot be resized`);
		this.store.put({ ...entry, modal: { ...modal, width, height } });
	}

	showModal(
		connection: PluginConnection,
		surfaceId: string,
		title: string,
		width: number | undefined,
		height: number | undefined
	): void {
		const entry = this.ensure(connection, surfaceId);
		this.store.put({
			...entry,
			visible: true,
			modal: {
				title,
				width: width === undefined ? DEFAULT_MODAL_WIDTH : width,
				height: height === undefined ? DEFAULT_MODAL_HEIGHT : height
			}
		});
	}

	/** The surface exists for as long as the worker that created it. */
	private ensure(connection: PluginConnection, surfaceId: string): SurfaceEntry {
		const existing = this.store.get(connection.pluginId, surfaceId);
		if (existing !== undefined) return existing;
		const entry: SurfaceEntry = {
			key: surfaceKey(connection.pluginId, surfaceId),
			pluginId: connection.pluginId,
			surfaceId,
			tree: null,
			version: 0,
			visible: false,
			modal: null
		};
		let owned = this.owned.get(connection);
		if (owned === undefined) {
			owned = new Set();
			this.owned.set(connection, owned);
		}
		owned.add(surfaceId);
		connection.context.effect(
			() => () => {
				this.store.remove(connection.pluginId, surfaceId);
				this.owned.get(connection)?.delete(surfaceId);
			},
			`plugin ${connection.pluginId} surface ${surfaceId}`
		);
		this.store.put(entry);
		return entry;
	}

	private isDeclaredPanel(connection: PluginConnection, surfaceId: string): boolean {
		return connection.manifest.contributes.panels.some((panel) => panel.id === surfaceId);
	}

	// ---------- the user's side ----------

	/** The user closed a modal (its X, Escape, the backdrop): hide it and tell the plugin. */
	closeFromUser(pluginId: string, surfaceId: string): void {
		const entry = this.store.get(pluginId, surfaceId);
		if (entry === undefined) return;
		this.store.put({ ...entry, visible: false });
		this.host.connectionOf(pluginId)?.deliver('uiclose', { surface: surfaceId });
	}

	/** Start the plugin when a surface of it is shown for the first time. Failures show on the surface. */
	ensureStarted(pluginId: string): void {
		const record = this.registry.get(pluginId);
		if (record === undefined || record.status === 'failed') return;
		this.host.activate(pluginId).catch(() => undefined);
	}

	/**
	 * Report input to the plugin: run its handler as one plugin run, so what it changes is one undo
	 * step labelled `label` (a button's text) or the plugin's name.
	 */
	async dispatch(
		pluginId: string,
		surfaceId: string,
		handlerId: string,
		value: unknown,
		label: string | undefined
	): Promise<void> {
		const connection = this.host.connectionOf(pluginId);
		if (connection === undefined) return;
		const runLabel = label === undefined ? connection.manifest.name : label;
		try {
			await connection.runScoped(runLabel, 'ui', () =>
				connection.request('ui.event', { surface: surfaceId, handler: handlerId, value })
			);
		} catch (error) {
			connection.addLog('error', error instanceof Error ? error.message : String(error));
		}
	}

	snapshotState(): Record<string, unknown> {
		return {
			surfaces: this.store
				.all()
				.map((entry) => entry.key)
				.sort()
		};
	}
}
