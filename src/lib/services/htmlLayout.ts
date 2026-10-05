// The `htmlLayout` service: lays HTML out in a sandboxed iframe with the document's fonts and
// returns what the browser computed (src/lib/ai/html/layout.ts). AI writes go through it; a
// service rather than a direct call so tests and headless runs can provide their own layout.

import { Service, type Context } from '@neoworks/extension-system';
import { FALLBACK_FAMILY } from '../fonts/bundled';
import type { FontRef } from '../fonts/resolve';
import { measureHtml, type FontSource } from '../ai/html/layout';
import type { HtmlSnapshot } from '../ai/html/snapshot';
import { isItalic, weightOf } from '../text/fontFace';

declare module '@neoworks/extension-system' {
	interface Context {
		htmlLayout: HtmlLayoutService;
	}
}

/** What layout needs from the fonts service: which faces exist and their bytes. */
export interface FontLibrary {
	families(): string[];
	faces(): FontRef[];
	load(ref: FontRef): Promise<{ bytes: ArrayBuffer }>;
}

export interface HtmlLayoutRequest {
	/** Width of the page the HTML is laid out in. */
	viewportWidth: number;
	/** CSS custom properties declared on `:root`. */
	cssVariables: Readonly<Record<string, string>>;
}

/** Measures HTML; the service and test fakes implement it. */
export interface HtmlMeasurer {
	measure(html: string, request: HtmlLayoutRequest): Promise<HtmlSnapshot>;
}

const VIEWPORT_HEIGHT = 900;

export function fontSourceOf(fonts: FontLibrary): FontSource {
	return {
		families: () => fonts.families(),
		faces: async (family) => {
			const entries = fonts.faces().filter((face) => face.family === family);
			return Promise.all(
				entries.map(async (entry) => ({
					weight: weightOf(entry.style),
					italic: isItalic(entry.style),
					bytes: (await fonts.load(entry)).bytes
				}))
			);
		}
	};
}

export class HtmlLayoutService extends Service implements HtmlMeasurer {
	constructor(
		ctx: Context,
		private readonly fonts: FontLibrary
	) {
		super(ctx, 'htmlLayout');
	}

	measure(html: string, request: HtmlLayoutRequest): Promise<HtmlSnapshot> {
		return measureHtml(html, {
			viewportWidth: request.viewportWidth,
			viewportHeight: VIEWPORT_HEIGHT,
			defaultFamily: FALLBACK_FAMILY,
			monospaceFamily: 'Geist Mono',
			fonts: fontSourceOf(this.fonts),
			cssVariables: request.cssVariables
		});
	}
}
