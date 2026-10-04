import type { Context } from '@neoworks/extension-system';
import { SpatialService } from '../../lib/services/spatial';

// The `spatial` service: cached absolute bounds plus an R-tree per page, kept current from
// `document/change` and dropped on `document/replace`. Hit testing and culling build on it.
export default {
	name: 'spatial',
	inject: ['document'],
	apply(ctx: Context): void {
		const spatial = new SpatialService(ctx, ctx.document);
		ctx.on('document/change', (event) => spatial.handleDocumentChange(event));
		ctx.on('document/replace', () => spatial.handleDocumentReplace());
	}
};
