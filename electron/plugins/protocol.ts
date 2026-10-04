// main-protocol: serves the SvelteKit build over `app://design/`. The scheme itself is registered
// as privileged in main.ts before `ready` (Electron requires that, and it has no inverse); this
// plugin owns the handler, which is unregistered when the plugin unloads.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Plugin } from '@neoworks/extension-system';
import { z } from 'zod';

export const APP_SCHEME = 'app';

export const protocolConfigSchema = z.strictObject({
	/** Directory with the static build (`build/`). */
	buildDirectory: z.string()
});
export type ProtocolConfig = z.infer<typeof protocolConfigSchema>;

const FALLBACK_PAGE = '200.html';

/** The file to serve for a request path; unknown routes get the SPA fallback page. */
export function resolveBuildFile(buildDirectory: string, pathname: string): string {
	const root = path.resolve(buildDirectory);
	const candidate = path.resolve(root, `.${decodeURIComponent(pathname)}`);
	const insideBuild = candidate === root || candidate.startsWith(`${root}${path.sep}`);
	if (insideBuild && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
	return path.join(root, FALLBACK_PAGE);
}

export const mainProtocolPlugin: Plugin.Object<ProtocolConfig> = {
	name: 'main-protocol',
	inject: ['electron'],
	Config: protocolConfigSchema,
	apply(ctx, config) {
		const { electron } = ctx;
		ctx.effect(() => {
			// Handling needs the app to be ready; unhandle only if we got that far.
			let registered = false;
			let disposed = false;
			void electron.app.whenReady().then(() => {
				if (disposed) return;
				electron.protocol.handle(APP_SCHEME, (request) => {
					const { pathname } = new URL(request.url);
					const file = resolveBuildFile(config.buildDirectory, pathname);
					return electron.net.fetch(pathToFileURL(file).href);
				});
				registered = true;
			});
			return () => {
				disposed = true;
				if (registered) electron.protocol.unhandle(APP_SCHEME);
			};
		}, `protocol:${APP_SCHEME}`);
	}
};
