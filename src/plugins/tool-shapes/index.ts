import type { Context } from '@neoworks/extension-system';
import ArrowUpRightIcon from 'phosphor-svelte/lib/ArrowUpRightIcon';
import CircleIcon from 'phosphor-svelte/lib/CircleIcon';
import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
import PolygonIcon from 'phosphor-svelte/lib/PolygonIcon';
import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
import StarIcon from 'phosphor-svelte/lib/StarIcon';
import type { Component } from 'svelte';
import { CreationPreview, createCreationTool } from '../../lib/editing/creationTool.svelte';
import CreationPreviewOverlay from '../../lib/editing/CreationPreviewOverlay.svelte';
import { SHAPE_TOOLS } from './shapes';

// oxlint-disable-next-line typescript/no-explicit-any
const ICONS: Record<string, Component<any>> = {
	rectangle: SquareIcon,
	ellipse: CircleIcon,
	line: MinusIcon,
	arrow: ArrowUpRightIcon,
	polygon: PolygonIcon,
	star: StarIcon
};

// Rectangle (R), ellipse (O), line (L), arrow (Shift+L), polygon and star. Drag to draw, Alt from
// the centre, Shift for square or circle (15 degree steps for lines), click for 100 x 100. Each
// creation is one undo step. Polygon, star and arrow are not on the toolbar itself: the shapes
// menu of the toolbar is a follow-up, until then they run from the command palette.
export default {
	name: 'tool-shapes',
	inject: ['tools', 'document', 'selection'],
	apply(ctx: Context): void {
		for (const definition of SHAPE_TOOLS) {
			const preview = new CreationPreview();
			ctx.effect(
				() =>
					ctx.tools.register({
						id: definition.id,
						title: definition.title,
						icon: ICONS[definition.id],
						shortcut: definition.shortcut,
						group: 'create',
						order: definition.order,
						cursor: 'crosshair',
						toolbar: definition.toolbar,
						overlay: { component: CreationPreviewOverlay, props: { preview } },
						...createCreationTool(ctx, definition.spec, preview)
					}),
				`${definition.id} tool`
			);
		}
	}
};
