// The `pixelGrid` service (#46): the pixel grid switch and the pixel preview mode. The grid is an
// overlay contribution (lib/viewport/pixelGrid.ts); the preview is a flag the renderer reads
// (`renderer.setPixelPreview`).

import { Service, type Context } from '@neoworks/extension-system';
import { isPixelGridVisible } from '../viewport/pixelGrid';
import type { PixelGridState } from './pixelGridState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		pixelGrid: PixelGridService;
	}
}

export class PixelGridService extends Service {
	constructor(
		ctx: Context,
		private readonly state: PixelGridState
	) {
		super(ctx, 'pixelGrid');
	}

	get gridEnabled(): boolean {
		return this.state.gridEnabled;
	}

	get previewEnabled(): boolean {
		return this.state.previewEnabled;
	}

	/** Whether the grid is on screen right now: switched on and zoomed in far enough. */
	get gridVisible(): boolean {
		return this.state.gridEnabled && isPixelGridVisible(this.ctx.viewport.zoom);
	}

	setGridEnabled(enabled: boolean): void {
		this.state.gridEnabled = enabled;
	}

	toggleGrid(): void {
		this.setGridEnabled(!this.state.gridEnabled);
	}

	setPreviewEnabled(enabled: boolean): void {
		this.state.previewEnabled = enabled;
		this.ctx.renderer.setPixelPreview(enabled);
	}

	togglePreview(): void {
		this.setPreviewEnabled(!this.state.previewEnabled);
	}
}
