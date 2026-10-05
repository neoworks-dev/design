import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { parseParams } from '../../lib/plugins/api/schemas';
import { PluginStorageService } from '../../lib/services/pluginStorage';

const nodeId = z.string().min(1).max(200);
const key = z.string().min(1).max(256);
const schemas = {
	data: z.strictObject({ nodeId, key }),
	setData: z.strictObject({ nodeId, key, value: z.string().max(200_000) }),
	nodeOnly: z.strictObject({ nodeId }),
	shared: z.strictObject({ nodeId, namespace: z.string().min(1).max(100), key }),
	setShared: z.strictObject({
		nodeId,
		namespace: z.string().min(1).max(100),
		key,
		value: z.string().max(200_000)
	}),
	sharedKeys: z.strictObject({ nodeId, namespace: z.string().min(1).max(100) }),
	relaunch: z.strictObject({
		nodeId,
		data: z.record(z.string().min(1).max(200), z.string().max(200))
	}),
	clientKey: z.strictObject({ key }),
	clientSet: z.strictObject({ key, value: z.unknown() })
};

// Third-party plugins, part seven (#160): provides `pluginStorage` and the `storage` API. Node data
// (`pluginData`, `sharedPluginData`, relaunch data) is stored in the document through
// `document.apply` as part of the plugin's run, so it is undoable and saved with the file;
// `clientStorage` is per plugin and lives in main's user data, outside the document. All of it needs
// the `storage` permission.
export default {
	name: 'plugin-storage',
	inject: ['pluginHost', 'document', 'desktop', 'pluginUndo'],
	apply(ctx: Context): void {
		const storage = new PluginStorageService(ctx, ctx.document, ctx.pluginUndo, ctx.pluginHost, {
			get: (pluginId, name) => ctx.desktop.pluginsStorageGet(pluginId, name),
			set: (pluginId, name, value) => ctx.desktop.pluginsStorageSet(pluginId, name, value),
			delete: (pluginId, name) => ctx.desktop.pluginsStorageDelete(pluginId, name),
			keys: (pluginId) => ctx.desktop.pluginsStorageKeys(pluginId)
		});

		ctx.effect(
			() =>
				ctx.pluginHost.registerApi('storage', {
					getData: {
						permission: 'storage',
						run: (call, params) => {
							const request = parseParams(schemas.data, params);
							return storage.getData(call.pluginId, request.nodeId, request.key);
						}
					},
					setData: {
						permission: 'storage',
						run: (call, params) => {
							const request = parseParams(schemas.setData, params);
							storage.setData(call.pluginId, call.run, request.nodeId, request.key, request.value);
						}
					},
					dataKeys: {
						permission: 'storage',
						run: (call, params) =>
							storage.dataKeys(call.pluginId, parseParams(schemas.nodeOnly, params).nodeId)
					},
					getSharedData: {
						permission: 'storage',
						run: (_call, params) => {
							const request = parseParams(schemas.shared, params);
							return storage.getSharedData(request.nodeId, request.namespace, request.key);
						}
					},
					setSharedData: {
						permission: 'storage',
						run: (call, params) => {
							const request = parseParams(schemas.setShared, params);
							storage.setSharedData(
								call.pluginId,
								call.run,
								request.nodeId,
								request.namespace,
								request.key,
								request.value
							);
						}
					},
					sharedDataKeys: {
						permission: 'storage',
						run: (_call, params) => {
							const request = parseParams(schemas.sharedKeys, params);
							return storage.sharedDataKeys(request.nodeId, request.namespace);
						}
					},
					getRelaunchData: {
						permission: 'storage',
						run: (call, params) =>
							storage.getRelaunchData(call.pluginId, parseParams(schemas.nodeOnly, params).nodeId)
					},
					setRelaunchData: {
						permission: 'storage',
						run: (call, params) => {
							const request = parseParams(schemas.relaunch, params);
							storage.setRelaunchData(call.pluginId, call.run, request.nodeId, request.data);
						}
					},
					clientGet: {
						permission: 'storage',
						run: (call, params) =>
							storage.clientGet(call.pluginId, parseParams(schemas.clientKey, params).key)
					},
					clientSet: {
						permission: 'storage',
						run: (call, params) => {
							const request = parseParams(schemas.clientSet, params);
							return storage.clientSet(call.pluginId, request.key, request.value);
						}
					},
					clientDelete: {
						permission: 'storage',
						run: (call, params) =>
							storage.clientDelete(call.pluginId, parseParams(schemas.clientKey, params).key)
					},
					clientKeys: {
						permission: 'storage',
						run: (call) => storage.clientKeys(call.pluginId)
					}
				}),
			'plugin api storage'
		);
	}
};
