import type { Context } from '@neoworks/extension-system';
import { defaultTextStyle, type TextStyle } from '../../lib/document';
import { FALLBACK_FAMILY } from '../../lib/fonts/bundled';

/**
 * The style a new text starts with: the document default, except that a font which is not
 * available is replaced by the bundled one, so nothing is flagged as missing from the start.
 */
export function defaultTextStyleFor(ctx: Context): TextStyle {
	const style = defaultTextStyle();
	if (!ctx.fonts.resolve(style.fontName).missing) return style;
	return { ...style, fontName: { family: FALLBACK_FAMILY, style: 'Regular' } };
}
