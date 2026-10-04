import { Service, type Context } from '@neoworks/extension-system';
import type { WasmLocator } from '../../lib/render/canvaskit';
import { CanvasKitService } from './service';
import { bundledWasmLocator } from './wasmUrl';

export interface CanvasKitConfig {
	/** Where the wasm file is found. Defaults to the bundled asset; tests pass a Node path. */
	locateFile?: WasmLocator;
}

// Provides `canvaskit`: the loaded module and surface creation. The plugin is not ACTIVE until
// the wasm is compiled, so plugins that inject `canvaskit` simply wait in PENDING.
export default {
	name: 'canvaskit',
	inject: [],
	async apply(ctx: Context, config?: CanvasKitConfig): Promise<void> {
		const locateFile = config?.locateFile ?? bundledWasmLocator;
		const service = new CanvasKitService(ctx, locateFile);
		await service[Service.init]();
	}
};
