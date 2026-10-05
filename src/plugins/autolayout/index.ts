import type { Context } from '@neoworks/extension-system';
import { generateNodeId } from '../../lib/document';
import { applyEdit, contributeCommand, type MenuPlacement } from '../../lib/editing/contribute';
import { isStackContainer } from '../../lib/layout/build';
import { planAddAutoLayout, planRemoveAutoLayout } from '../../lib/layout/toggle';
import { AutoLayoutService } from './service';

const MENUS: MenuPlacement[] = [
	{ menu: 'context/canvas', group: '3_group' },
	{ menu: 'context/layer', group: '3_group' }
];

function selectionHasAutoLayout(ctx: Context): boolean {
	return ctx.selection.ids.some((id) => {
		if (!ctx.document.has(id)) return false;
		return isStackContainer(ctx.document.require(id));
	});
}

function addAutoLayout(ctx: Context): void {
	const plan = planAddAutoLayout(ctx.document.reader, ctx.selection.ids, generateNodeId);
	if (!applyEdit(ctx, plan.changes, 'Add auto layout')) return;
	ctx.selection.select(plan.selectIds);
}

function removeAutoLayout(ctx: Context): void {
	const changes = planRemoveAutoLayout(ctx.document.reader, ctx.selection.ids);
	applyEdit(ctx, changes, 'Remove auto layout');
}

// Publishes `selectionHasAutoLayout` so "Remove auto layout" only offers itself where it applies.
function publishContextKey(ctx: Context): void {
	let dispose: () => void = () => undefined;
	const publish = (): void => {
		dispose = ctx.contextKeys.set('selectionHasAutoLayout', selectionHasAutoLayout(ctx));
	};
	ctx.effect(() => {
		publish();
		return () => dispose();
	}, 'autolayout context key');
	ctx.on('selection/change', publish);
	ctx.on('document/change', publish);
}

// Auto layout: provides `ctx.autolayout` and reflows every auto layout tree a transaction
// disturbs, inside that transaction (a `document/append` step, data-model.md section 5). The
// engine is pure (lib/layout); this plugin supplies resolved nodes and text measurement, and the
// commands Shift+A (add, with inference) and Alt+Shift+A (remove).
//
// Order with the other append listeners: text-layout fits auto-sized text in the same step; the
// engine measures text itself, so either order converges, and the settle loop in `document.apply`
// runs the next round on whatever the other listener appended. Component sync (not built yet)
// must append its propagation first: reflow reads the synced sizes, so a main component's layout
// result reaches its instances through the sync, not through a second layout of each instance.
export default {
	name: 'autolayout',
	inject: [
		'document',
		'variables',
		'textLayout',
		'selection',
		'commands',
		'keymap',
		'menus',
		'contextKeys'
	],
	apply(ctx: Context): void {
		const service = new AutoLayoutService(ctx);

		ctx.on('document/append', ({ changes, meta }, next) => {
			const others = next();
			if (meta.replay !== undefined) return others;
			return [...others, ...service.reflowFor(changes)];
		});

		publishContextKey(ctx);
		contributeCommand(ctx, {
			id: 'autolayout.add',
			title: 'Add auto layout',
			when: 'hasSelection',
			run: () => addAutoLayout(ctx),
			keys: ['Shift+A'],
			menus: MENUS.map((placement) => ({ ...placement, order: 5 }))
		});
		contributeCommand(ctx, {
			id: 'autolayout.remove',
			title: 'Remove auto layout',
			when: 'selectionHasAutoLayout',
			run: () => removeAutoLayout(ctx),
			keys: ['Alt+Shift+A'],
			menus: MENUS.map((placement) => ({ ...placement, order: 6 }))
		});
	}
};
