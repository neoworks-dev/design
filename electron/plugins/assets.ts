// main-assets: the `assets:*` IPC routes over the open file's `assets` and `fonts` tables: images
// by content hash, embedded font files. The tables and the garbage collection live in
// store/assetStore.ts; this plugin only resolves the sender's file and forwards.

import type { Plugin } from '@neoworks/extension-system';
import { route } from '../kernel/route';

export const mainAssetsPlugin: Plugin.Object = {
	name: 'main-assets',
	inject: ['electron', 'ipc', 'store'],
	apply(ctx) {
		route(ctx, 'assets:put', (request, event) => {
			return ctx.store.current(event.sender).putAsset(request);
		});
		route(ctx, 'assets:get', (request, event) => {
			return ctx.store.current(event.sender).readAssetBytes(request.hash);
		});
		route(ctx, 'assets:collect', (_payload, event) => {
			return ctx.store.current(event.sender).collectAssets();
		});
		route(ctx, 'assets:embedFont', (request, event) => {
			const { bytes, ...face } = request;
			ctx.store.current(event.sender).embedFont(face, bytes);
		});
		route(ctx, 'assets:fontBytes', (face, event) => {
			return ctx.store.current(event.sender).readEmbeddedFont(face);
		});
		route(ctx, 'assets:embeddedFonts', (_payload, event) => {
			return ctx.store.current(event.sender).embeddedFonts();
		});
	}
};
