// main-fonts: lists the installed fonts and serves their bytes over `fonts:*`.
//
// The font directories are scanned once, on the first request; the result and every loaded file
// are cached by family + style for the life of the plugin (installing a font needs a restart).
// Font file paths never leave main: the renderer addresses faces by `{ family, style }`.

import type { Plugin } from '@neoworks/extension-system';
import type { FontRef } from '../bridge';
import type { HostFontFile } from '../kernel/host';
import { route } from '../kernel/route';

export function fontKey(ref: FontRef): string {
	return `${ref.family}\u0000${ref.style}`.toLowerCase();
}

export const mainFontsPlugin: Plugin.Object = {
	name: 'main-fonts',
	inject: ['electron', 'ipc'],
	apply(ctx) {
		let scan: Promise<Map<string, HostFontFile>> | null = null;
		const bytes = new Map<string, Promise<Uint8Array>>();

		function installed(): Promise<Map<string, HostFontFile>> {
			if (scan === null) {
				scan = ctx.electron.fonts.scan().then((files) => {
					const byKey = new Map<string, HostFontFile>();
					for (const file of files) if (!byKey.has(fontKey(file))) byKey.set(fontKey(file), file);
					return byKey;
				});
				// A failed scan must not stick: the next request tries again.
				scan.catch(() => {
					scan = null;
				});
			}
			return scan;
		}

		// The caches die with the plugin's fiber, like every other effect.
		ctx.effect(
			() => () => {
				scan = null;
				bytes.clear();
			},
			'main-fonts:caches'
		);

		route(ctx, 'fonts:list', async () => {
			const files = await installed();
			return [...files.values()].map((file) => ({ family: file.family, style: file.style }));
		});

		route(ctx, 'fonts:load', async (ref) => {
			const file = (await installed()).get(fontKey(ref));
			if (!file) return null;
			const key = fontKey(ref);
			let pending = bytes.get(key);
			if (!pending) {
				pending = ctx.electron.fonts.read(file.file);
				bytes.set(key, pending);
				pending.catch(() => bytes.delete(key));
			}
			return pending;
		});
	}
};
