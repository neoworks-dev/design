import type { Context } from '@neoworks/extension-system';
import { ViewportService } from './service';
import { ViewportState } from './state.svelte';

/** Pixels one arrow key press pans; Shift pans four times as far. */
export const PAN_STEP = 60;
export const PAN_STEP_FAST = 240;

interface ViewCommand {
	id: string;
	title: string;
	run: (viewport: ViewportService, args?: unknown) => void;
	/** Written chords bound in the `global` scope. */
	keys: string[];
	menuGroup?: string;
}

interface PanArguments {
	deltaX: number;
	deltaY: number;
}

function isPanArguments(value: unknown): value is PanArguments {
	if (typeof value !== 'object' || value === null) return false;
	return (
		typeof Reflect.get(value, 'deltaX') === 'number' &&
		typeof Reflect.get(value, 'deltaY') === 'number'
	);
}

const VIEW_COMMANDS: ViewCommand[] = [
	{
		id: 'viewport.zoom-in',
		title: 'Zoom in',
		run: (viewport) => viewport.stepZoom('in'),
		keys: ['Mod+=', 'Mod++'],
		menuGroup: '1_zoom'
	},
	{
		id: 'viewport.zoom-out',
		title: 'Zoom out',
		run: (viewport) => viewport.stepZoom('out'),
		keys: ['Mod+-'],
		menuGroup: '1_zoom'
	},
	{
		id: 'viewport.zoom-100',
		title: 'Zoom to 100%',
		run: (viewport) => viewport.zoomTo(1),
		keys: ['Shift+0', 'Mod+0'],
		menuGroup: '1_zoom'
	},
	{
		id: 'viewport.zoom-to-fit',
		title: 'Zoom to fit',
		run: (viewport) => void viewport.zoomToFit(),
		keys: ['Shift+1'],
		menuGroup: '1_zoom'
	},
	{
		id: 'viewport.zoom-to-selection',
		title: 'Zoom to selection',
		run: (viewport) => void viewport.zoomToSelection(),
		keys: ['Shift+2'],
		menuGroup: '1_zoom'
	},
	{
		id: 'viewport.next-frame',
		title: 'Next frame',
		run: (viewport) => void viewport.nextFrame(),
		keys: ['N'],
		menuGroup: '2_frames'
	},
	{
		id: 'viewport.previous-frame',
		title: 'Previous frame',
		run: (viewport) => void viewport.previousFrame(),
		keys: ['Shift+N'],
		menuGroup: '2_frames'
	},
	{
		id: 'viewport.pan',
		title: 'Pan canvas',
		run: (viewport, args) => {
			if (isPanArguments(args)) viewport.panBy(args.deltaX, args.deltaY);
		},
		keys: []
	}
];

interface PanKey {
	key: string;
	deltaX: number;
	deltaY: number;
}

// Arrow keys move the camera only while nothing is selected (with a selection they nudge it).
const PAN_KEYS: PanKey[] = [
	{ key: 'ArrowLeft', deltaX: PAN_STEP, deltaY: 0 },
	{ key: 'ArrowRight', deltaX: -PAN_STEP, deltaY: 0 },
	{ key: 'ArrowUp', deltaX: 0, deltaY: PAN_STEP },
	{ key: 'ArrowDown', deltaX: 0, deltaY: -PAN_STEP }
];

// Provides `viewport`: the camera (pan, zoom, per-page memory), its commands and shortcuts, the
// wheel / pinch handling. The zoom control is the zoom-menu plugin. The renderer draws through the
// camera this plugin hands it.
export default {
	name: 'viewport',
	inject: ['renderer', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		const viewport = new ViewportService(ctx, new ViewportState());

		ctx.renderer.setViewProvider(() => viewport.camera);
		ctx.on('viewport/change', () => ctx.renderer.requestFrame('viewport'));
		ctx.on('canvas/resize', (size) => viewport.setSize(size));
		ctx.on('scene/page-change', (pageId) => viewport.setPage(pageId));
		ctx.on('canvas/wheel', (event) => viewport.handleWheel(event));

		const source = ctx.renderer.sceneSource;
		if (source) viewport.setPage(source.currentPageId());

		for (const command of VIEW_COMMANDS) {
			ctx.effect(
				() =>
					ctx.commands.register({
						id: command.id,
						title: command.title,
						run: (args) => command.run(viewport, args)
					}),
				`command ${command.id}`
			);
			for (const key of command.keys) {
				ctx.effect(
					() => ctx.keymap.register({ key, command: command.id, scope: 'global' }),
					`shortcut ${key} ${command.id}`
				);
			}
			if (command.menuGroup === undefined) continue;
			const item = { id: command.id, command: command.id, group: command.menuGroup };
			ctx.effect(
				() => ctx.menus.register({ menu: 'app/view', item }),
				`menu app/view ${command.id}`
			);
			ctx.effect(
				() =>
					ctx.menus.register({
						menu: 'context/canvas-empty',
						item: { ...item, group: `5${item.group}` }
					}),
				`menu context/canvas-empty ${command.id}`
			);
		}

		for (const pan of PAN_KEYS) {
			const args: PanArguments = { deltaX: pan.deltaX, deltaY: pan.deltaY };
			const fastArgs: PanArguments = { deltaX: pan.deltaX * 4, deltaY: pan.deltaY * 4 };
			ctx.effect(
				() =>
					ctx.keymap.register({
						key: pan.key,
						command: 'viewport.pan',
						args,
						when: '!hasSelection',
						scope: 'global',
						repeat: true
					}),
				`shortcut ${pan.key} pan`
			);
			ctx.effect(
				() =>
					ctx.keymap.register({
						key: `Shift+${pan.key}`,
						command: 'viewport.pan',
						args: fastArgs,
						when: '!hasSelection',
						scope: 'global',
						repeat: true
					}),
				`shortcut Shift+${pan.key} pan`
			);
		}
	}
};
