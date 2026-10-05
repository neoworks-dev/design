// The `pluginPermissions` service: what the user allowed each third-party plugin. Provided by plugin
// `plugin-permissions`.
//
// A manifest only declares what a plugin may ask for. The first time a plugin calls something that
// needs one of its declared permissions, the user is asked once for all of them (a prompt entry in
// `prompts`, rendered by the plugin's dialog). The answer is stored by main per plugin (and per
// project for plugins that live in a project) and can be changed any time from the plugin manager.
// Bundled plugins ship with the app and hold what they declare.
//
// The host asks through the serial event `plugins/permission`; this service answers it.

import { Service, type Context } from '@neoworks/extension-system';
import type { PluginPermission } from '../plugins/manifest';
import type { PluginRecord } from '../plugins/types';
import { Registry, type RegistryEntry } from '../registries/registry.svelte';
import type { PluginRegistryService } from './pluginRegistry';

declare module '@neoworks/extension-system' {
	interface Context {
		pluginPermissions: PluginPermissionsService;
	}
	interface Events {
		/** Dispatch mode: emit. The stored decisions (permissions, enabled) were read or changed. */
		'plugins/decisions-changed'(): void;
	}
}

/** Stored next to the permissions: `false` means the user turned the plugin off. */
export const ENABLED_KEY = 'enabled';

export type PermissionDecision = 'granted' | 'denied' | 'undecided';

/** Stored decisions of one plugin; `id` is the plugin id. */
interface DecisionEntry extends RegistryEntry {
	decisions: Record<string, boolean>;
}

/** One question to the user, shown by the permission dialog. */
export interface PermissionPrompt extends RegistryEntry {
	pluginId: string;
	pluginName: string;
	permissions: PluginPermission[];
	allowedDomains: string[];
	answer(allow: boolean): void;
}

/** Where decisions are stored: main's `plugin-permissions.json`. */
export interface PermissionStore {
	load(): Promise<Record<string, Record<string, boolean>>>;
	save(
		pluginId: string,
		permission: string,
		granted: boolean | null
	): Promise<Record<string, Record<string, boolean>>>;
}

interface Holder {
	asking: Map<string, Promise<void>>;
	promptCounter: number;
}

export class PluginPermissionsService extends Service {
	readonly decisions = new Registry<DecisionEntry>();
	/** Questions waiting for the user, oldest first. */
	readonly prompts = new Registry<PermissionPrompt>();
	private readonly holder: Holder = { asking: new Map(), promptCounter: 0 };
	private readonly stored = new Map<string, () => void>();

	constructor(
		ctx: Context,
		private readonly registry: PluginRegistryService,
		private readonly store: PermissionStore
	) {
		super(ctx, 'pluginPermissions');
	}

	/** Read the stored decisions. */
	async load(): Promise<void> {
		this.adopt(await this.store.load());
	}

	private adopt(all: Record<string, Record<string, boolean>>): void {
		for (const [pluginId, dispose] of this.stored) {
			if (all[pluginId] === undefined) {
				dispose();
				this.stored.delete(pluginId);
			}
		}
		for (const [pluginId, decisions] of Object.entries(all)) {
			this.stored.set(pluginId, this.decisions.register({ id: pluginId, decisions }));
		}
		this.ctx.emit('plugins/decisions-changed');
	}

	/** Ids of the plugins the user turned off. */
	disabledIds(): string[] {
		return this.decisions
			.listAll()
			.filter((entry) => entry.decisions[ENABLED_KEY] === false)
			.map((entry) => entry.id);
	}

	/** Turn a plugin on or off; remembered across sessions. */
	async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
		let decision: boolean | null = false;
		if (enabled) decision = null;
		await this.set(pluginId, ENABLED_KEY, decision);
	}

	/** Reactive: the decision for one permission of a plugin. */
	decisionFor(pluginId: string, permission: string): PermissionDecision {
		const record = this.registry.get(pluginId);
		if (record !== undefined && record.source === 'builtin') {
			if (record.manifest?.permissions.some((declared) => declared === permission) === true) {
				return 'granted';
			}
		}
		const decision = this.decisions.get(pluginId)?.decisions[permission];
		if (decision === undefined) return 'undecided';
		if (decision) return 'granted';
		return 'denied';
	}

	/** Allow, deny or forget (`null`) one permission of a plugin. */
	async set(pluginId: string, permission: string, granted: boolean | null): Promise<void> {
		this.adopt(await this.store.save(pluginId, permission, granted));
	}

	/** The answer of the `plugins/permission` event: `undefined` lets the call through. */
	async check(pluginId: string, permission: PluginPermission): Promise<string | undefined> {
		if (this.decisionFor(pluginId, permission) === 'undecided') await this.askOnce(pluginId);
		const decision = this.decisionFor(pluginId, permission);
		if (decision === 'granted') return undefined;
		return `"${permission}" was denied for plugin "${pluginId}"`;
	}

	/** Several calls at once share one question. */
	private askOnce(pluginId: string): Promise<void> {
		const running = this.holder.asking.get(pluginId);
		if (running !== undefined) return running;
		const asked = this.ask(pluginId).finally(() => this.holder.asking.delete(pluginId));
		this.holder.asking.set(pluginId, asked);
		return asked;
	}

	private async ask(pluginId: string): Promise<void> {
		const record = this.registry.get(pluginId);
		if (record === undefined || record.manifest === null) return;
		const undecided = record.manifest.permissions.filter(
			(permission) => this.decisionFor(pluginId, permission) === 'undecided'
		);
		if (undecided.length === 0) return;
		const allow = await this.prompt(record, undecided);
		for (const permission of undecided) await this.set(pluginId, permission, allow);
	}

	private prompt(record: PluginRecord, permissions: PluginPermission[]): Promise<boolean> {
		const manifest = record.manifest;
		if (manifest === null) return Promise.resolve(false);
		this.holder.promptCounter += 1;
		const id = `${record.id}#${this.holder.promptCounter}`;
		let allowedDomains: string[] = [];
		if (manifest.networkAccess !== undefined)
			allowedDomains = manifest.networkAccess.allowedDomains;
		return new Promise<boolean>((resolve) => {
			const dispose = this.prompts.register({
				id,
				pluginId: record.id,
				pluginName: manifest.name,
				permissions,
				allowedDomains,
				answer: (allow) => {
					dispose();
					resolve(allow);
				}
			});
		});
	}

	/** Deny everything asked for plugins that stopped existing; the user closed the dialog by quitting. */
	cancelPrompts(): void {
		for (const prompt of this.prompts.listAll()) prompt.answer(false);
	}

	snapshotState(): Record<string, unknown> {
		return {
			decisions: this.decisions.listAll().map((entry) => entry.id),
			prompts: this.prompts.listAll().length
		};
	}
}
