import type { Context } from '@neoworks/extension-system';
import { StylesService } from '../../lib/services/styles';

// Paint, text, effect and grid styles (#113): provides `ctx.styles`. Two kernel hooks keep the
// document consistent:
//   - `document/before-apply` detaches a node from its style when an edit changes a value the
//     style provides (the edit and the detach are one `set`);
//   - `document/append` rewrites the raw copies on every consumer when a style's value changes,
//     in the same transaction (one undo step), so stored nodes always match what readers resolve.
// The style button in the design sections and the lists in the Page section and the assets panel
// are contributed by those plugins and call this service.
export default {
	name: 'styles',
	inject: ['document'],
	apply(ctx: Context): void {
		const service = new StylesService(ctx, ctx.document);

		ctx.on('document/before-apply', (_changes, meta, next) => {
			const result = next();
			if (meta.replay !== undefined) return result;
			return service.rewriteEdits(result);
		});
		ctx.on('document/append', ({ changes, meta }, next) => {
			const others = next();
			if (meta.replay !== undefined) return others;
			return [...others, ...service.syncFor(changes)];
		});
	}
};
