// The `pluginStorage` service: what third-party plugins keep. Provided by plugin `plugin-storage`.
//
//   pluginData / sharedPluginData   strings on nodes, in the document, written through
//                                   `document.apply` (undoable, saved with the file)
//   relaunchData                    commands a node offers, so a plugin can be run again from it
//   clientStorage                   JSON per plugin in main's user data, outside the document
//
// Caps and namespaces are in lib/plugins/pluginData.ts.

import { Service, type Context } from '@neoworks/extension-system';
import type { Node, NodeId } from '../document';
import type { PluginRun } from '../plugins/connection';
import {
	entryKeys,
	privateNamespace,
	readEntry,
	readRelaunchData,
	sharedNamespace,
	withEntry,
	withRelaunchData
} from '../plugins/pluginData';
import type { PluginUndo } from '../plugins/api/undo';
import type { DocumentService } from './document';
import type { PluginHostService } from './pluginHost';

declare module '@neoworks/extension-system' {
	interface Context {
		pluginStorage: PluginStorageService;
	}
}

/** A button a node offers because its plugin asked for it with `setRelaunchData`. */
export interface RelaunchAction {
	pluginId: string;
	command: string;
	label: string;
}

/** Where `clientStorage` lives: main's per-plugin files. */
export interface ClientStorageBackend {
	get(pluginId: string, key: string): Promise<unknown>;
	set(pluginId: string, key: string, value: unknown): Promise<void>;
	delete(pluginId: string, key: string): Promise<void>;
	keys(pluginId: string): Promise<string[]>;
}

const PRIVATE_PREFIX = 'plugin:';

export class PluginStorageService extends Service {
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly undo: PluginUndo,
		private readonly host: PluginHostService,
		private readonly client: ClientStorageBackend
	) {
		super(ctx, 'pluginStorage');
	}

	private requireNode(id: NodeId): Node {
		const node = this.document.get(id);
		if (node === undefined) throw new Error(`node ${id} does not exist`);
		return node;
	}

	private write(
		pluginId: string,
		run: PluginRun | null,
		nodeId: NodeId,
		next: Node['pluginData'],
		label: string
	): void {
		const changes = this.document.setProps(nodeId, { pluginData: next });
		if (changes.length === 0) return;
		this.document.apply(changes, {
			origin: 'plugin',
			label: `${pluginId}: ${label}`,
			runId: this.undo.runIdFor(run)
		});
	}

	// ---------- pluginData (private) ----------

	getData(pluginId: string, nodeId: NodeId, key: string): string {
		return readEntry(this.requireNode(nodeId).pluginData, privateNamespace(pluginId), key);
	}

	dataKeys(pluginId: string, nodeId: NodeId): string[] {
		return entryKeys(this.requireNode(nodeId).pluginData, privateNamespace(pluginId));
	}

	/** The empty string deletes the key. Throws above the 100 kB entry cap. */
	setData(
		pluginId: string,
		run: PluginRun | null,
		nodeId: NodeId,
		key: string,
		value: string
	): void {
		const node = this.requireNode(nodeId);
		const next = withEntry(node.pluginData, privateNamespace(pluginId), key, value);
		this.write(pluginId, run, nodeId, next, 'set plugin data');
	}

	// ---------- sharedPluginData ----------

	getSharedData(nodeId: NodeId, namespace: string, key: string): string {
		return readEntry(this.requireNode(nodeId).pluginData, sharedNamespace(namespace), key);
	}

	sharedDataKeys(nodeId: NodeId, namespace: string): string[] {
		return entryKeys(this.requireNode(nodeId).pluginData, sharedNamespace(namespace));
	}

	setSharedData(
		pluginId: string,
		run: PluginRun | null,
		nodeId: NodeId,
		namespace: string,
		key: string,
		value: string
	): void {
		const node = this.requireNode(nodeId);
		const next = withEntry(node.pluginData, sharedNamespace(namespace), key, value);
		this.write(pluginId, run, nodeId, next, 'set shared plugin data');
	}

	// ---------- relaunch data ----------

	getRelaunchData(pluginId: string, nodeId: NodeId): Record<string, string> {
		return readRelaunchData(this.requireNode(nodeId).pluginData, pluginId);
	}

	setRelaunchData(
		pluginId: string,
		run: PluginRun | null,
		nodeId: NodeId,
		relaunch: Record<string, string>
	): void {
		const node = this.requireNode(nodeId);
		const next = withRelaunchData(node.pluginData, pluginId, relaunch);
		this.write(pluginId, run, nodeId, next, 'set relaunch data');
	}

	/** Every button a node offers, over all plugins, in plugin id order. */
	relaunchActions(nodeId: NodeId): RelaunchAction[] {
		const actions: RelaunchAction[] = [];
		const data = this.requireNode(nodeId).pluginData;
		for (const namespace of Object.keys(data).sort()) {
			if (!namespace.startsWith(PRIVATE_PREFIX)) continue;
			const pluginId = namespace.slice(PRIVATE_PREFIX.length);
			for (const [command, label] of Object.entries(readRelaunchData(data, pluginId))) {
				actions.push({ pluginId, command, label });
			}
		}
		return actions;
	}

	/** Run the plugin's command for a relaunch button; the command receives `{ relaunch, nodeId }`. */
	runRelaunch(action: RelaunchAction, nodeId: NodeId): Promise<void> {
		this.requireNode(nodeId);
		return this.host.runtime.runCommand(action.pluginId, action.command, {
			relaunch: action.command,
			nodeId
		});
	}

	// ---------- clientStorage ----------

	clientGet(pluginId: string, key: string): Promise<unknown> {
		return this.client.get(pluginId, key);
	}

	clientSet(pluginId: string, key: string, value: unknown): Promise<void> {
		return this.client.set(pluginId, key, value);
	}

	clientDelete(pluginId: string, key: string): Promise<void> {
		return this.client.delete(pluginId, key);
	}

	clientKeys(pluginId: string): Promise<string[]> {
		return this.client.keys(pluginId);
	}
}
