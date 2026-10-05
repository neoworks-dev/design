// main-plugin-permissions: what the user allowed each third-party plugin, and the things a plugin
// may only get through main: HTTP requests (checked against its `networkAccess` allowlist and its
// `network` permission) and its `clientStorage`.
//
// Decisions live in `plugin-permissions.json` in the user data directory, per plugin and, for
// plugins that live in a project, per project: trusting a plugin of one shared file says nothing
// about another file with a plugin of the same id. Bundled plugins ship with the app and hold the
// permissions they declare. The renderer asks the user (`plugin-permissions`); main enforces the
// network side again so a compromised renderer path cannot skip it.

import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import { z } from 'zod';
import type {
	DiscoveredPlugin,
	PluginFetchRequest,
	PluginFetchResponse,
	PluginPermissionDecisions
} from '../bridge';
import type { SenderHandle } from '../kernel/host';
import { IpcError, route } from '../kernel/route';
import { NetworkAccessError, requireAllowedUrl } from '../../src/lib/plugins/network';
import { manifestId } from './pluginDiscovery';

export const PERMISSIONS_FILE = 'plugin-permissions.json';
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

const decisionsFileSchema = z.object({
	decisions: z.record(z.string(), z.record(z.string(), z.boolean()))
});

export function parseDecisionsFile(text: string | undefined): PluginPermissionDecisions {
	if (text === undefined) return {};
	try {
		const parsed = decisionsFileSchema.safeParse(JSON.parse(text));
		if (!parsed.success) return {};
		return parsed.data.decisions;
	} catch {
		return {};
	}
}

const declaredSchema = z.object({
	permissions: z.array(z.string()).default([]),
	networkAccess: z.object({ allowedDomains: z.array(z.string()).default([]) }).optional()
});

function declaredOf(plugin: DiscoveredPlugin): z.infer<typeof declaredSchema> {
	const parsed = declaredSchema.safeParse(plugin.manifest);
	if (!parsed.success) return { permissions: [] };
	return parsed.data;
}

export class PluginPermissionsService extends Service {
	private decisions: PluginPermissionDecisions | null = null;

	constructor(ctx: Context) {
		super(ctx, 'pluginPermissions');
	}

	private load(): PluginPermissionDecisions {
		if (this.decisions === null) {
			this.decisions = parseDecisionsFile(this.ctx.electron.userData.readText(PERMISSIONS_FILE));
		}
		return this.decisions;
	}

	private save(decisions: PluginPermissionDecisions): void {
		this.decisions = decisions;
		this.ctx.electron.userData.writeText(
			PERMISSIONS_FILE,
			JSON.stringify({ decisions }, null, '\t')
		);
	}

	private scopeKey(plugin: DiscoveredPlugin, project: string | null, pluginId: string): string {
		if (plugin.source === 'project') return `project:${project}:${pluginId}`;
		return `${plugin.source}:${pluginId}`;
	}

	/** The decisions of the sender's window, by plugin id. */
	async decisionsFor(sender: SenderHandle): Promise<PluginPermissionDecisions> {
		const list = await this.ctx.pluginDiscovery.list(sender);
		const stored = this.load();
		const result: PluginPermissionDecisions = {};
		for (const plugin of list.plugins) {
			const pluginId = manifestId(plugin);
			if (pluginId === null) continue;
			const own = stored[this.scopeKey(plugin, list.project, pluginId)];
			if (own !== undefined && result[pluginId] === undefined) result[pluginId] = { ...own };
		}
		return result;
	}

	async set(
		sender: SenderHandle,
		pluginId: string,
		permission: string,
		granted: boolean | null
	): Promise<PluginPermissionDecisions> {
		const plugin = await this.ctx.pluginDiscovery.findById(sender, pluginId);
		const { project } = await this.ctx.pluginDiscovery.list(sender);
		const key = this.scopeKey(plugin, project, pluginId);
		const next = { ...this.load() };
		const own = { ...next[key] };
		if (granted === null) delete own[permission];
		else own[permission] = granted;
		if (Object.keys(own).length === 0) delete next[key];
		else next[key] = own;
		this.save(next);
		return this.decisionsFor(sender);
	}

	private async isGranted(
		sender: SenderHandle,
		plugin: DiscoveredPlugin,
		permission: string
	): Promise<boolean> {
		if (!declaredOf(plugin).permissions.includes(permission)) return false;
		if (plugin.source === 'builtin') return true;
		const pluginId = manifestId(plugin);
		if (pluginId === null) return false;
		const decisions = await this.decisionsFor(sender);
		return decisions[pluginId]?.[permission] === true;
	}

	/** An HTTP request for a plugin: needs the `network` permission and a host on its allowlist. */
	async fetch(sender: SenderHandle, request: PluginFetchRequest): Promise<PluginFetchResponse> {
		const plugin = await this.ctx.pluginDiscovery.findById(sender, request.pluginId);
		if (!(await this.isGranted(sender, plugin, 'network'))) {
			throw new IpcError(
				'HANDLER_FAILED',
				`plugin "${request.pluginId}" does not have the "network" permission`
			);
		}
		const allowed = declaredOf(plugin).networkAccess?.allowedDomains ?? [];
		let url: URL;
		try {
			url = requireAllowedUrl(request.url, allowed);
		} catch (error) {
			if (error instanceof NetworkAccessError) throw new IpcError('HANDLER_FAILED', error.message);
			throw error;
		}
		const response = await this.ctx.electron.net.fetch(url.href, {
			method: request.method,
			headers: request.headers,
			body: request.body,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		const body = await response.text();
		if (body.length > MAX_RESPONSE_BYTES) {
			throw new IpcError('HANDLER_FAILED', 'the response is larger than a plugin may receive');
		}
		const headers: Record<string, string> = {};
		response.headers.forEach((value, name) => {
			headers[name] = value;
		});
		return { status: response.status, statusText: response.statusText, headers, body };
	}

	snapshotState(): Record<string, unknown> {
		return {};
	}
}

declare module '@neoworks/extension-system' {
	interface Context {
		pluginPermissions: PluginPermissionsService;
	}
}

export const mainPluginPermissionsPlugin: Plugin.Object = {
	name: 'main-plugin-permissions',
	inject: ['electron', 'ipc', 'pluginDiscovery'],
	apply(ctx) {
		const permissions = new PluginPermissionsService(ctx);
		route(ctx, 'plugins:permissions', (_payload, event) => permissions.decisionsFor(event.sender));
		route(ctx, 'plugins:setPermission', (request, event) =>
			permissions.set(event.sender, request.pluginId, request.permission, request.granted)
		);
		route(ctx, 'plugins:fetch', (request, event) => permissions.fetch(event.sender, request));
	}
};
