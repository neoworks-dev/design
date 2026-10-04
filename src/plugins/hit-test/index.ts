import type { Context } from '@neoworks/extension-system';
import { HitTestService } from '../../lib/services/hitTest';

// The `hitTest` service: exact hit testing over the spatial index, with selection scope rules,
// clipping and masks. Canvas tools and hover use it; nothing here draws.
export default {
	name: 'hit-test',
	inject: ['document', 'spatial', 'selection'],
	apply(ctx: Context): void {
		new HitTestService(ctx, ctx.document, ctx.spatial, ctx.selection);
	}
};
