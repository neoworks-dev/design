import type { Context } from '@neoworks/extension-system';
import { planConstraints } from '../../lib/constraints/engine';

// Constraints: when a frame without auto layout is resized, its children follow their
// constraints. A `document/append` step, so the child changes join the resizing transaction
// (one undo step, data-model.md section 5). Ctrl while resizing sets `meta.ignoreConstraints`.
// The widget that edits constraints lives in the layout section (`inspector-layout-size`).
//
// Order with the other append listeners does not matter: auto layout reads the sizes this step
// writes in the next round of the settle loop in `document.apply`.
export default {
	name: 'constraints',
	inject: ['document'],
	apply(ctx: Context): void {
		ctx.on('document/append', ({ changes, meta }, next) => {
			const others = next();
			if (meta.replay !== undefined || meta.ignoreConstraints === true) return others;
			const planned = planConstraints(
				ctx.document.reader,
				(id) => ctx.document.childNodes(id),
				changes
			);
			return [...others, ...planned];
		});
	}
};
