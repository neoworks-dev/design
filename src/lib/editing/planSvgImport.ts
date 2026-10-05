// Pasting or dropping SVG markup as vector layers (#106). The `svg-import` plugin answers the
// `clipboard/svg-payload` waterfall with the imported nodes; this plans their insertion with the
// ordinary paste rules. Without that plugin nothing answers and the caller falls back (the
// clipboard rasterises the SVG into an image).

import type { Context } from '@neoworks/extension-system';
import { planPaste, type PastePlan, type PasteSettings } from './paste';

/** The paste plan for `markup`, or null when no importer is loaded or it is not valid SVG. */
export function planSvgImport(
	ctx: Context,
	markup: string,
	settings: PasteSettings,
	name?: string
): PastePlan | null {
	const payload = ctx.waterfall('clipboard/svg-payload', markup, name, () => null);
	if (payload === null) return null;
	return planPaste(ctx.document.reader, payload, settings);
}
