import type { Context } from '@neoworks/extension-system';
import { AutoLayoutService } from './service';

// Auto layout: provides `ctx.autolayout` and reflows every auto layout tree a transaction
// disturbs, inside that transaction (a `document/append` step, data-model.md section 5). The
// engine is pure (lib/layout); this plugin supplies resolved nodes and text measurement.
//
// Order with the other append listeners: text-layout fits auto-sized text in the same step; the
// engine measures text itself, so either order converges, and the settle loop in `document.apply`
// runs the next round on whatever the other listener appended. Component sync (not built yet)
// must append its propagation first: reflow reads the synced sizes, so a main component's layout
// result reaches its instances through the sync, not through a second layout of each instance.
export default {
	name: 'autolayout',
	inject: ['document', 'variables', 'textLayout'],
	apply(ctx: Context): void {
		const service = new AutoLayoutService(ctx);

		ctx.on('document/append', ({ changes, meta }, next) => {
			const others = next();
			if (meta.replay !== undefined) return others;
			return [...others, ...service.reflowFor(changes)];
		});
	}
};
