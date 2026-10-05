// Plugin data on nodes (Figma's `setPluginData` / `setSharedPluginData`), kept in the node's
// `pluginData` map (data-model.md section 1: namespaced strings, saved with the file). Two kinds
// share that one map, told apart by the namespace prefix:
//
//   private   `plugin:<plugin id>`      only that plugin reads and writes it
//   shared    `shared:<namespace>`      any plugin that knows the namespace
//
// The prefixes keep a plugin from reaching what built-in features keep there under bare names
// (`comments`, `components`). Pure: the plugin storage API turns the result into a `document.apply`.

import type { Node } from '../document';

export type PluginDataMap = Node['pluginData'];

/** Figma caps one entry at 100 kB. */
export const MAX_PLUGIN_DATA_ENTRY_BYTES = 100 * 1000;

const RELAUNCH_KEY = 'relaunchData';

export class PluginDataError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PluginDataError';
	}
}

export function privateNamespace(pluginId: string): string {
	return `plugin:${pluginId}`;
}

/** A shared namespace is at least three letters or digits, like Figma's. */
export function sharedNamespace(namespace: string): string {
	if (!/^[A-Za-z0-9_-]{3,64}$/.test(namespace)) {
		throw new PluginDataError(
			`"${namespace}" is not a valid namespace: use 3 to 64 letters, digits, - or _`
		);
	}
	return `shared:${namespace}`;
}

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function requireKey(key: string): void {
	if (key.length === 0) throw new PluginDataError('a key is required');
}

export function readEntry(data: PluginDataMap, namespace: string, key: string): string {
	const entries = data[namespace];
	if (entries === undefined) return '';
	if (!Object.hasOwn(entries, key)) return '';
	return entries[key];
}

export function entryKeys(data: PluginDataMap, namespace: string): string[] {
	const entries = data[namespace];
	if (entries === undefined) return [];
	return Object.keys(entries);
}

/**
 * `data` with `key` set to `value` in `namespace`; the empty string removes the entry (and an
 * emptied namespace). Throws when key and value together exceed the entry cap.
 */
export function withEntry(
	data: PluginDataMap,
	namespace: string,
	key: string,
	value: string
): PluginDataMap {
	requireKey(key);
	const entries = { ...data[namespace] };
	if (value === '') {
		delete entries[key];
	} else {
		if (byteLength(key) + byteLength(value) > MAX_PLUGIN_DATA_ENTRY_BYTES) {
			throw new PluginDataError(`the entry "${key}" is larger than 100 kB`);
		}
		entries[key] = value;
	}
	const next = { ...data };
	if (Object.keys(entries).length === 0) delete next[namespace];
	else next[namespace] = entries;
	return next;
}

/** Relaunch data: command id to the label of the button that runs it on this node. */
export function readRelaunchData(data: PluginDataMap, pluginId: string): Record<string, string> {
	const text = readEntry(data, privateNamespace(pluginId), RELAUNCH_KEY);
	if (text === '') return {};
	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed !== 'object' || parsed === null) return {};
		const result: Record<string, string> = {};
		for (const [command, label] of Object.entries(parsed)) {
			if (typeof label === 'string') result[command] = label;
		}
		return result;
	} catch {
		return {};
	}
}

export function withRelaunchData(
	data: PluginDataMap,
	pluginId: string,
	relaunch: Record<string, string>
): PluginDataMap {
	let value = '';
	if (Object.keys(relaunch).length > 0) value = JSON.stringify(relaunch);
	return withEntry(data, privateNamespace(pluginId), RELAUNCH_KEY, value);
}
