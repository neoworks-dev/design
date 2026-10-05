// `design.storage`: data a plugin keeps. Node data (`getData`, `getSharedData`, relaunch data) is
// stored in the document, so it is undoable and saved with the file; `clientStorage` is per plugin
// on this machine and not part of the document. All of it needs the `storage` permission.

import type { SdkEnv } from './design';

export interface ClientStorageApi {
	/** The stored value, or `undefined` when there is none. */
	get(key: string): Promise<unknown>;
	/** Any JSON value; a plugin may keep up to 5 MB. */
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	keys(): Promise<string[]>;
}

export interface StorageApi {
	/** Private data of this plugin on a node; `''` when the key is not set. */
	getData(nodeId: string, key: string): Promise<string>;
	/** Set private data; the empty string deletes the key. An entry may be up to 100 kB. */
	setData(nodeId: string, key: string, value: string): Promise<void>;
	dataKeys(nodeId: string): Promise<string[]>;
	/** Data any plugin may read and write under `namespace` (at least 3 letters or digits). */
	getSharedData(nodeId: string, namespace: string, key: string): Promise<string>;
	setSharedData(nodeId: string, namespace: string, key: string, value: string): Promise<void>;
	sharedDataKeys(nodeId: string, namespace: string): Promise<string[]>;
	/** Commands the node offers to run this plugin again: command id to button label. */
	getRelaunchData(nodeId: string): Promise<Record<string, string>>;
	setRelaunchData(nodeId: string, data: Record<string, string>): Promise<void>;
	readonly clientStorage: ClientStorageApi;
}

export function createStorageApi(env: SdkEnv): StorageApi {
	return {
		getData: (nodeId, key) => env.call<string>('storage.getData', { nodeId, key }),
		setData: async (nodeId, key, value) => {
			await env.call('storage.setData', { nodeId, key, value });
		},
		dataKeys: (nodeId) => env.call<string[]>('storage.dataKeys', { nodeId }),
		getSharedData: (nodeId, namespace, key) =>
			env.call<string>('storage.getSharedData', { nodeId, namespace, key }),
		setSharedData: async (nodeId, namespace, key, value) => {
			await env.call('storage.setSharedData', { nodeId, namespace, key, value });
		},
		sharedDataKeys: (nodeId, namespace) =>
			env.call<string[]>('storage.sharedDataKeys', { nodeId, namespace }),
		getRelaunchData: (nodeId) =>
			env.call<Record<string, string>>('storage.getRelaunchData', { nodeId }),
		setRelaunchData: async (nodeId, data) => {
			await env.call('storage.setRelaunchData', { nodeId, data });
		},
		clientStorage: {
			get: async (key) => {
				const value = await env.call('storage.clientGet', { key });
				if (value === null) return undefined;
				return value;
			},
			set: async (key, value) => {
				await env.call('storage.clientSet', { key, value });
			},
			delete: async (key) => {
				await env.call('storage.clientDelete', { key });
			},
			keys: () => env.call<string[]>('storage.clientKeys')
		}
	};
}
