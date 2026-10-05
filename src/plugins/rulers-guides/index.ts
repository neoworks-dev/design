import type { Context } from '@neoworks/extension-system';
import type { Rect } from '../../lib/document';
import { contributeCommand } from '../../lib/editing/contribute';
import { drawGuides, drawRulers } from '../../lib/rulers/draw';
import { GuideLineClaimant, RulerClaimant } from '../../lib/rulers/guideInteraction';
import { placedGuides, type PlacedGuide } from '../../lib/rulers/guides';
import { RulersGuidesService } from '../../lib/services/rulersGuides';
import { RulersGuidesState } from '../../lib/services/rulersGuidesState.svelte';
import type { SnapLine } from '../../lib/snapping/lineSnap';

function selectionBounds(ctx: Context): Rect | undefined {
	let union: Rect | undefined;
	for (const id of ctx.selection.ids) {
		if (!ctx.document.has(id)) continue;
		const bounds = ctx.document.absoluteBounds(id);
		if (union === undefined) {
			union = bounds;
			continue;
		}
		const left = Math.min(union.x, bounds.x);
		const top = Math.min(union.y, bounds.y);
		const right = Math.max(union.x + union.width, bounds.x + bounds.width);
		const bottom = Math.max(union.y + union.height, bounds.y + bounds.height);
		union = { x: left, y: top, width: right - left, height: bottom - top };
	}
	return union;
}

// Rulers along the top and left edge of the canvas (Shift+R) and guides (docs/research/
// interactions.md section 5): dragging from a ruler creates a guide, dragging it back deletes it,
// Ctrl+; hides them. Guides are document data (`guides` on the page, or on the frame they were
// made in) edited through `document.apply`, so every change is undoable. Objects snap to visible
// guides through `snapping.addLineSource`. The rulers and guides draw on the overlay; presses on
// them are pointer claimants of the canvas input router.
export default {
	name: 'rulers-guides',
	inject: [
		'overlay',
		'snapping',
		'document',
		'canvasInput',
		'viewport',
		'selection',
		'commands',
		'keymap',
		'menus'
	],
	apply(ctx: Context): void {
		const state = new RulersGuidesState();
		const service = new RulersGuidesService(ctx, state);

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'rulers-guides/guides',
					order: 30,
					track: () => {
						void service.guidesVisible;
						void service.draft;
					},
					draw: (frame) => {
						if (!service.guidesVisible && service.draft === null) return;
						let guides: PlacedGuide[] = [];
						if (service.guidesVisible) {
							guides = placedGuides(ctx.document.reader, ctx.document.currentPageId);
						}
						drawGuides(frame, guides, service.draft);
					}
				}),
			'rulers-guides/guides overlay'
		);
		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'rulers-guides/rulers',
					order: 90,
					track: () => void service.rulersVisible,
					draw: (frame) => {
						if (service.rulersVisible) drawRulers(frame, { selection: selectionBounds(ctx) });
					}
				}),
			'rulers-guides/rulers overlay'
		);

		ctx.effect(() => ctx.canvasInput.claim(new RulerClaimant(ctx)), 'rulers-guides/ruler claim');
		ctx.effect(
			() => ctx.canvasInput.claim(new GuideLineClaimant(ctx)),
			'rulers-guides/guide claim'
		);

		ctx.effect(
			() =>
				ctx.snapping.addLineSource((): SnapLine[] => {
					if (!service.guidesVisible) return [];
					return placedGuides(ctx.document.reader, ctx.document.currentPageId).map((guide) => ({
						axis: guide.axis === 'X' ? 'x' : 'y',
						position: guide.position,
						span: guide.span
					}));
				}),
			'rulers-guides/snap lines'
		);

		contributeCommand(ctx, {
			id: 'view.toggle-rulers',
			title: 'Rulers',
			keys: ['Shift+R'],
			run: () => service.setRulersVisible(!service.rulersVisible),
			menus: [{ menu: 'app/view', group: '6_guides', order: 1 }]
		});
		contributeCommand(ctx, {
			id: 'view.toggle-guides',
			title: 'Guides',
			keys: ['Mod+;'],
			run: () => service.setGuidesVisible(!service.guidesVisible),
			menus: [{ menu: 'app/view', group: '6_guides', order: 2 }]
		});
	}
};
