import type { Context } from '@neoworks/extension-system';
import { HtmlLayoutService } from '../../lib/services/htmlLayout';

// Provides `htmlLayout`: HTML measured in a sandboxed, offscreen iframe with the document's fonts,
// as a plain snapshot the AI's HTML converter turns into layers. Each measurement opens and
// removes its own iframe, so nothing outlives a call.
export default {
	name: 'html-layout',
	inject: ['fonts'],
	apply(ctx: Context): void {
		new HtmlLayoutService(ctx, ctx.fonts);
	}
};
