// The `pluginManager` service: the installed third-party plugins as a list a person can act on.
// Provided by plugin `plugin-manager`. It owns no data: every row is read from the registry (what
// was found, its status), the permissions service (what the user allowed) and the host (what runs).
//
// Enabling and disabling turns a plugin's whole contribution off: the registry marks it `disabled`
// and the manifest loader unloads its stubs and its worker, so every effect it had is reverted.

import { Service, type Context } from '@neoworks/extension-system';
import type { PluginList, PluginSourceKind } from '../../../electron/bridge';
import type { PluginPermission } from '../plugins/manifest';
import type { PluginRecord, PluginStatus } from '../plugins/types';
import type { PermissionDecision, PluginPermissionsService } from './pluginPermissions';
import type { PluginHostService } from './pluginHost';
import type { PluginManagerState } from './pluginManagerState.svelte';
import type { PluginRegistryService } from './pluginRegistry';

declare module '@neoworks/extension-system' {
	interface Context {
		pluginManager: PluginManagerService;
	}
}

/** What the manager asks main to do; the plugin wires it to the `desktop` service. */
export interface ManagerBackend {
	installFromDialog(kind: 'folder' | 'zip'): Promise<PluginList | null>;
	install(path: string): Promise<PluginList>;
	remove(directoryName: string): Promise<PluginList>;
	reveal(source: PluginSourceKind, directoryName: string): Promise<void>;
	setTrust(trusted: boolean): Promise<PluginList>;
}

export interface PermissionRow {
	permission: PluginPermission;
	decision: PermissionDecision;
}

export interface PluginRow {
	id: string;
	name: string;
	version: string;
	description: string;
	source: PluginSourceKind;
	directoryName: string;
	status: PluginStatus;
	/** Why it does not run, or the manifest problems. */
	problem: string | null;
	warnings: string[];
	enabled: boolean;
	commands: { id: string; title: string }[];
	permissions: PermissionRow[];
	allowedDomains: string[];
	/** Only plugins installed in the user directory can be deleted from here. */
	removable: boolean;
	/** The plugin can be switched on and off (it has a valid manifest). */
	switchable: boolean;
}

const NOT_RUNNABLE: PluginStatus[] = [
	'invalid',
	'incompatible',
	'untrusted',
	'shadowed',
	'disabled'
];

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export class PluginManagerService extends Service {
	constructor(
		ctx: Context,
		private readonly state: PluginManagerState,
		private readonly registry: PluginRegistryService,
		private readonly host: PluginHostService,
		private readonly permissions: PluginPermissionsService,
		private readonly backend: ManagerBackend
	) {
		super(ctx, 'pluginManager');
	}

	// ---------- reads (reactive) ----------

	get isOpen(): boolean {
		return this.state.open;
	}

	get expandedId(): string | null {
		return this.state.expandedId;
	}

	get project(): string | null {
		return this.state.project;
	}

	get projectTrust(): PluginList['projectTrust'] {
		return this.state.projectTrust;
	}

	get notice(): { text: string; error: boolean } | null {
		return this.state.notice;
	}

	get dragging(): boolean {
		return this.state.dragging;
	}

	get busy(): boolean {
		return this.state.busy;
	}

	rows(): PluginRow[] {
		return this.registry.records().map((record) => this.rowOf(record));
	}

	/** Rows of plugins that can run a command now, for the Resources search. */
	runnableRows(): PluginRow[] {
		return this.rows().filter(
			(row) => row.commands.length > 0 && !NOT_RUNNABLE.includes(row.status)
		);
	}

	private rowOf(record: PluginRecord): PluginRow {
		const manifest = record.manifest;
		const permissions: PermissionRow[] = [];
		if (manifest !== null) {
			for (const permission of manifest.permissions) {
				permissions.push({
					permission,
					decision: this.permissions.decisionFor(record.id, permission)
				});
			}
		}
		let problem = record.error;
		if (record.status === 'disabled') problem = null;
		const row: PluginRow = {
			id: record.id,
			name: record.directoryName,
			version: '',
			description: '',
			source: record.source,
			directoryName: record.directoryName,
			status: record.status,
			problem,
			warnings: record.warnings,
			enabled: record.status !== 'disabled',
			commands: [],
			permissions,
			allowedDomains: [],
			removable: record.source === 'user',
			switchable: manifest !== null
		};
		if (manifest === null) return row;
		row.name = manifest.name;
		row.version = manifest.version;
		if (manifest.description !== undefined) row.description = manifest.description;
		row.commands = manifest.contributes.commands.map(({ id, title }) => ({ id, title }));
		if (manifest.networkAccess !== undefined) {
			row.allowedDomains = manifest.networkAccess.allowedDomains;
		}
		return row;
	}

	// ---------- dialog ----------

	openDialog(): void {
		this.state.open = true;
	}

	closeDialog(): void {
		this.state.open = false;
		this.state.dragging = false;
	}

	toggleDialog(): void {
		if (this.state.open) this.closeDialog();
		else this.openDialog();
	}

	expand(id: string | null): void {
		if (this.state.expandedId === id) this.state.expandedId = null;
		else this.state.expandedId = id;
	}

	setDragging(dragging: boolean): void {
		this.state.dragging = dragging;
	}

	/** Remember what main said about the window's project (trust prompt of the dialog). */
	adoptList(list: PluginList): void {
		this.state.project = list.project;
		this.state.projectTrust = list.projectTrust;
	}

	// ---------- actions ----------

	private async attempt(action: () => Promise<string | null>): Promise<void> {
		this.state.busy = true;
		try {
			const text = await action();
			if (text !== null) this.state.notice = { text, error: false };
		} catch (error) {
			this.state.notice = { text: describeError(error), error: true };
		} finally {
			this.state.busy = false;
		}
	}

	/** Switch a plugin on or off; off unloads its stubs and worker. */
	setEnabled(id: string, enabled: boolean): Promise<void> {
		return this.attempt(async () => {
			await this.permissions.setEnabled(id, enabled);
			return null;
		});
	}

	run(id: string, commandId: string): Promise<void> {
		return this.attempt(async () => {
			this.closeDialog();
			await this.ctx.commands.run(commandId);
			return null;
		});
	}

	restart(id: string): Promise<void> {
		return this.attempt(async () => {
			await this.host.restart(id);
			return `Restarted ${id}`;
		});
	}

	setPermission(id: string, permission: PluginPermission, granted: boolean | null): Promise<void> {
		return this.attempt(async () => {
			await this.permissions.set(id, permission, granted);
			return null;
		});
	}

	installFromDialog(kind: 'folder' | 'zip'): Promise<void> {
		return this.attempt(async () => {
			const list = await this.backend.installFromDialog(kind);
			if (list === null) return null;
			this.adoptList(list);
			return 'Plugin installed';
		});
	}

	installPath(path: string): Promise<void> {
		return this.attempt(async () => {
			this.adoptList(await this.backend.install(path));
			return 'Plugin installed';
		});
	}

	remove(id: string): Promise<void> {
		const row = this.rows().find((candidate) => candidate.id === id);
		return this.attempt(async () => {
			if (row === undefined || !row.removable)
				throw new Error('Only installed plugins can be removed');
			await this.permissions.set(id, 'enabled', null);
			this.adoptList(await this.backend.remove(row.directoryName));
			return `Removed ${row.name}`;
		});
	}

	reveal(id: string): Promise<void> {
		const row = this.rows().find((candidate) => candidate.id === id);
		return this.attempt(async () => {
			if (row === undefined) return null;
			await this.backend.reveal(row.source, row.directoryName);
			return null;
		});
	}

	trustProject(trusted: boolean): Promise<void> {
		return this.attempt(async () => {
			this.adoptList(await this.backend.setTrust(trusted));
			return null;
		});
	}

	snapshotState(): Record<string, unknown> {
		return { open: this.state.open };
	}
}
