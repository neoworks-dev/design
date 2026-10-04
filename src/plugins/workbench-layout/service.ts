import { Service, type Context } from '@neoworks/extension-system';
import { LayoutState, type LayoutStorage } from './layoutState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		'workbench-layout': WorkbenchLayoutService;
	}
}

/**
 * Exposes the chrome state to the plugin's components (`getKernel()['workbench-layout']`). The
 * reactive state lives in `LayoutState`, a plain field: services hold no runes.
 */
export class WorkbenchLayoutService extends Service {
	readonly state: LayoutState;

	constructor(ctx: Context, storage?: LayoutStorage) {
		super(ctx, 'workbench-layout');
		this.state = new LayoutState(storage);
	}

	snapshotState(): string {
		return this.state.serialize();
	}
}
