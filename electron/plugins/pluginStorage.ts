// main-plugin-storage: `clientStorage` of third-party plugins (Figma's `figma.clientStorage`).
// One JSON file per plugin in the user data directory, outside the document and never synced with
// it: it belongs to the user's machine. Values are JSON; a plugin may keep at most 5 MB.

import type { Plugin } from '@neoworks/extension-system';
import { IpcError, route } from '../kernel/route';
import type { ElectronHost } from '../kernel/host';

/** Figma allows 5 MB per plugin; the same here. */
export const MAX_CLIENT_STORAGE_BYTES = 5 * 1024 * 1024;

export function storageFileName(pluginId: string): string {
	return `plugin-storage-${pluginId}.json`;
}

function readEntries(
	userData: ElectronHost['userData'],
	pluginId: string
): Record<string, unknown> {
	const text = userData.readText(storageFileName(pluginId));
	// No prototype: a plugin may use any key, including `__proto__`.
	const entries: Record<string, unknown> = Object.create(null);
	if (text === undefined) return entries;
	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return entries;
		return Object.assign(entries, parsed);
	} catch {
		return entries;
	}
}

function writeEntries(
	userData: ElectronHost['userData'],
	pluginId: string,
	entries: Record<string, unknown>
): void {
	const text = JSON.stringify(entries);
	if (text.length > MAX_CLIENT_STORAGE_BYTES) {
		throw new IpcError('HANDLER_FAILED', `clientStorage of "${pluginId}" would exceed 5 MB`);
	}
	userData.writeText(storageFileName(pluginId), text);
}

export const mainPluginStoragePlugin: Plugin.Object = {
	name: 'main-plugin-storage',
	inject: ['electron', 'ipc'],
	apply(ctx) {
		const { userData } = ctx.electron;
		route(ctx, 'plugins:storageGet', ({ pluginId, key }) => {
			const entries = readEntries(userData, pluginId);
			if (!Object.hasOwn(entries, key)) return null;
			return entries[key];
		});
		route(ctx, 'plugins:storageSet', ({ pluginId, key, value }) => {
			if (value === undefined) throw new IpcError('INVALID_PAYLOAD', 'a value is required');
			const entries = readEntries(userData, pluginId);
			entries[key] = value;
			writeEntries(userData, pluginId, entries);
		});
		route(ctx, 'plugins:storageDelete', ({ pluginId, key }) => {
			const entries = readEntries(userData, pluginId);
			delete entries[key];
			writeEntries(userData, pluginId, entries);
		});
		route(ctx, 'plugins:storageKeys', ({ pluginId }) =>
			Object.keys(readEntries(userData, pluginId))
		);
	}
};
