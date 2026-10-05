import type { Context } from '@neoworks/extension-system';
import { importSvg } from '../../lib/svg/importSvg';
import { svgPayload } from '../../lib/svg/payload';

// SVG import (docs/research/interactions.md section 12): SVG text on the clipboard or an `.svg`
// file dropped on the canvas becomes a frame of vector layers instead of an image. The plugin
// answers the `clipboard/svg-payload` waterfall; the clipboard and tool-image plugins plan the
// insertion with the normal paste rules, so one paste or drop is one undo step. What the
// importer drops or approximates is reported on `svg-import/warnings` and logged.
export default {
	name: 'svg-import',
	inject: ['document'],
	apply(ctx: Context): void {
		ctx.on('clipboard/svg-payload', (markup, name, next) => {
			const imported = importSvg(markup, { name });
			if (imported === null) return next();
			if (imported.warnings.length > 0) {
				ctx.logger.warn(`svg import: ${imported.warnings.join('; ')}`);
				ctx.emit('svg-import/warnings', imported.warnings, name);
			}
			return svgPayload(imported, ctx.document.documentId, ctx.document.currentPageId);
		});
	}
};
