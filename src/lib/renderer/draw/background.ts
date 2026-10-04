import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneSource } from '../sceneSource';

/** Color shown outside any artwork when the page has no visible solid background. */
const FALLBACK_BACKGROUND = { r: 0.96, g: 0.96, b: 0.96 };

export function pageBackground(canvasKit: CanvasKit, source: SceneSource): Float32Array {
	const color = pageBackgroundColor(source);
	return canvasKit.Color4f(color.r, color.g, color.b, 1);
}

function pageBackgroundColor(source: SceneSource): { r: number; g: number; b: number } {
	const pageId = source.currentPageId();
	if (pageId === null) return FALLBACK_BACKGROUND;
	const page = source.getNode(pageId);
	if (!page || page.type !== 'PAGE') return FALLBACK_BACKGROUND;
	const resolved = source.resolve(page);
	for (const paint of resolved.backgrounds) {
		if (paint.visible && paint.type === 'SOLID') return paint.color;
	}
	return FALLBACK_BACKGROUND;
}
