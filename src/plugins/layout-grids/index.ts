import type { Context } from '@neoworks/extension-system';
import { contributeCommand } from '../../lib/editing/contribute';
import { drawLayoutGrids, type GridFrame } from '../../lib/layout-grids/draw';
import { gridFrames, gridSnapLines } from '../../lib/layout-grids/frames';
import { LayoutGridsState } from '../../lib/layout-grids/state.svelte';
import LayoutGridSection from './LayoutGridSection.svelte';

const FRAME_TYPES = ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];

// Layout grids on frames (columns, rows, grid) as guides, not auto layout. The grids are document
// data on the frame (`layoutGrids`), edited by the "Layout guide" design section; they draw on the
// overlay and, while visible (Shift+G), objects snap to their band edges and lines.
export default {
	name: 'layout-grids',
	inject: [
		'overlay',
		'inspectors',
		'snapping',
		'document',
		'selection',
		'commands',
		'keymap',
		'menus',
		'colorPicker',
		'variables',
		'styles'
	],
	apply(ctx: Context): void {
		const state = new LayoutGridsState();

		let cachedRevision = -1;
		let cachedPage = '';
		let cached: GridFrame[] = [];
		function frames(): GridFrame[] {
			const revision = ctx.document.revision;
			const page = ctx.document.currentPageId;
			if (revision === cachedRevision && page === cachedPage) return cached;
			cached = gridFrames(ctx);
			cachedRevision = revision;
			cachedPage = page;
			return cached;
		}

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'layout-grids/grids',
					order: 5,
					track: () => void state.visible,
					draw: (frame) => {
						if (state.visible) drawLayoutGrids(frame, frames());
					}
				}),
			'layout-grids/overlay'
		);

		ctx.effect(
			() =>
				ctx.snapping.addLineSource(() => {
					if (!state.visible) return [];
					return gridSnapLines(frames());
				}),
			'layout-grids/snap lines'
		);

		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'layout-grid',
					tab: 'design',
					title: 'Layout guide',
					order: 70,
					applies: (selection) => selection.count === 1 && FRAME_TYPES.includes(selection.kind),
					component: LayoutGridSection
				}),
			'layout-grids/section'
		);

		contributeCommand(ctx, {
			id: 'view.toggle-layout-grids',
			title: 'Layout grids',
			keys: ['Shift+G'],
			run: () => {
				state.visible = !state.visible;
			},
			menus: [{ menu: 'app/view', group: '6_guides', order: 3 }]
		});
	}
};
