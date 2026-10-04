// The CanvasKit implementation of RenderBackend: clear with the page background, apply the camera,
// draw the page's nodes. A full-viewport redraw per frame, as recommended in
// docs/research/rendering.md; picture caching comes only when profiling asks for it.

import type { CanvasKit } from 'canvaskit-wasm';
import { createDrawContext } from './draw/context';
import { drawScene } from './draw/scene';
import { pageBackground } from './draw/background';
import type { SkiaTracker } from './ownership';
import type { RenderSurface } from './surface';
import type { FrameRequest, FrameResult, RenderBackend } from './types';

const NOT_DRAWN: FrameResult = { drawn: false, drawnNodes: 0, layers: 0 };

export class CanvasKitBackend implements RenderBackend {
	constructor(
		private readonly canvasKit: CanvasKit,
		private readonly tracker: SkiaTracker,
		private readonly surface: RenderSurface
	) {}

	resize(pixelWidth: number, pixelHeight: number): void {
		this.surface.resize(pixelWidth, pixelHeight);
	}

	render(request: FrameRequest): FrameResult {
		const scope = this.tracker.scope();
		let result = NOT_DRAWN;
		try {
			const drawn = this.surface.frame((canvas) => {
				const { source, view, devicePixelRatio } = request;
				canvas.clear(pageBackground(this.canvasKit, source));
				canvas.save();
				canvas.scale(devicePixelRatio, devicePixelRatio);
				canvas.translate(view.x, view.y);
				canvas.scale(view.scale, view.scale);
				const context = createDrawContext(this.canvasKit, canvas, scope, request);
				result = drawScene(context);
				canvas.restore();
			});
			if (!drawn) return NOT_DRAWN;
			return result;
		} finally {
			scope.dispose();
		}
	}

	dispose(): void {
		this.surface.dispose();
	}
}
