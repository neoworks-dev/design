// The `contextMenus` service: opens the registered context menus for a right click. It decides
// what a right click selects (like Figma: a node inside the selection keeps it, any other node
// replaces it, empty canvas clears it) and passes the cursor to the commands as the menu target.

import { Service, type Context } from '@neoworks/extension-system';
import type { NodeId } from '../document';
import type { MenusService } from '../registries/menus.svelte';
import type { DocumentService } from './document';
import type { HitTestService } from './hitTest';
import type { SelectionService } from './selection';

declare module '@neoworks/extension-system' {
	interface Context {
		contextMenus: ContextMenusService;
	}
}

export const SELECT_LAYER_MENU = 'context/select-layer';
export const SELECT_LAYER_COMMAND = 'context-menus.select-layer';

const HIT_SLACK_PIXELS = 4;

export interface ViewportReader {
	zoom: number;
	screenToWorld(point: { x: number; y: number }): { x: number; y: number };
}

/** What menu commands receive as `args` when the menu item passes no arguments of its own. */
export interface ContextMenuTarget {
	world: { x: number; y: number };
	screen: { x: number; y: number };
	nodeId?: NodeId;
}

/** True when `id` is selected or lies inside a selected node. */
export function isWithinSelection(
	document: DocumentService,
	selected: readonly NodeId[],
	id: NodeId
): boolean {
	if (selected.includes(id)) return true;
	const ancestorIds = document.ancestors(id).map((node) => node.id);
	return selected.some((selectedId) => ancestorIds.includes(selectedId));
}

export class ContextMenusService extends Service {
	private layerItemDisposers: Array<() => void> = [];

	constructor(
		ctx: Context,
		private readonly menus: MenusService,
		private readonly selection: SelectionService,
		private readonly hitTest: HitTestService,
		private readonly document: DocumentService,
		private readonly viewport: ViewportReader,
		private readonly canvasElement: () => HTMLElement | undefined
	) {
		super(ctx, 'contextMenus');
	}

	/** Right click on the canvas: select what is under the cursor, then open its menu. */
	openOnCanvas(event: MouseEvent): void {
		const target = this.targetOf(event);
		const hit = this.hitTest.topAtScope({
			point: target.world,
			tolerance: HIT_SLACK_PIXELS / this.viewport.zoom
		});
		this.clearLayerItems();
		if (hit === undefined) {
			this.selection.clear();
			this.menus.openFromEvent('canvas-empty', event, target);
			return;
		}
		if (!isWithinSelection(this.document, this.selection.ids, hit)) {
			this.selection.select([hit], 'replace', { source: 'canvas' });
		}
		this.offerLayerStack(target);
		this.menus.openFromEvent('canvas', event, { ...target, nodeId: hit });
	}

	/** Right click on a layers panel row: keep a selection that has the row, else select it. */
	openOnLayer(event: MouseEvent, nodeId: NodeId): void {
		this.clearLayerItems();
		if (!this.selection.ids.includes(nodeId)) {
			this.selection.select([nodeId], 'replace', { source: 'layers' });
		}
		const target: ContextMenuTarget = {
			world: { x: 0, y: 0 },
			screen: { x: event.clientX, y: event.clientY },
			nodeId
		};
		this.menus.openFromEvent('layer', event, target);
	}

	/** Right click on the panel's empty space. */
	openOnLayerPanel(event: MouseEvent): void {
		this.clearLayerItems();
		this.menus.openFromEvent('layer-panel', event, undefined);
	}

	snapshotState(): unknown {
		return { layerItems: this.layerItemDisposers.length };
	}

	/** Remove the "Select layer" entries of the last menu. */
	clearLayerItems(): void {
		const disposers = this.layerItemDisposers;
		this.layerItemDisposers = [];
		disposers.forEach((dispose) => dispose());
	}

	private targetOf(event: MouseEvent): ContextMenuTarget {
		const element = this.canvasElement();
		const box = element ? element.getBoundingClientRect() : { left: 0, top: 0 };
		const screen = { x: event.clientX - box.left, y: event.clientY - box.top };
		return { screen, world: this.viewport.screenToWorld(screen) };
	}

	/** The "Select layer" submenu lists every layer under the cursor, topmost first. */
	private offerLayerStack(target: ContextMenuTarget): void {
		const stack = this.hitTest.all({
			point: target.world,
			tolerance: HIT_SLACK_PIXELS / this.viewport.zoom
		});
		if (stack.length < 2) return;
		for (const id of stack) {
			const node = this.document.get(id);
			if (!node) continue;
			const dispose = this.ctx.effect(
				() =>
					this.menus.register({
						menu: SELECT_LAYER_MENU,
						item: {
							id,
							title: node.name,
							command: SELECT_LAYER_COMMAND,
							args: { id },
							group: '1'
						}
					}),
				`context-menus/select-layer ${id}`
			);
			this.layerItemDisposers.push(() => void dispose());
		}
	}
}
