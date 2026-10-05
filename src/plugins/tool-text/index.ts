import type { Context } from '@neoworks/extension-system';
import TextTIcon from 'phosphor-svelte/lib/TextTIcon';
import { createNode, plainText } from '../../lib/document';
import { CreationPreview, createCreationTool } from '../../lib/editing/creationTool.svelte';
import CreationPreviewOverlay from '../../lib/editing/CreationPreviewOverlay.svelte';
import type { PositionedNode } from '../../lib/editing/selectionOps';
import type { ToolPointerEvent } from '../../lib/tools/protocol';
import { defaultTextStyleFor } from './defaults';

const PRIMARY_BUTTON = 0;
const HIT_TOLERANCE_PX = 4;

// Text tool (T). Click on empty canvas creates an auto-width text box and starts editing it;
// click-drag creates a box with a fixed width that grows in height. Click on an existing text
// starts editing it with the caret there. Starting the edit is the `text.edit` command of the
// `text-edit` plugin, so this plugin never imports the editor. The new node uses the file's
// default text style (Inter when it is available, else the bundled Geist), so it is not flagged
// as a missing font from the first keystroke. An empty text is removed when editing ends.
export default {
	name: 'tool-text',
	inject: ['tools', 'document', 'selection', 'commands', 'hitTest', 'viewport', 'fonts'],
	apply(ctx: Context): void {
		const preview = new CreationPreview();
		const creation = createCreationTool(
			ctx,
			{
				nodeType: 'TEXT',
				label: 'Text',
				geometry: 'box',
				clickSize: () => ({ width: 0, height: 0 }),
				build: (placement, name) => buildTextNode(ctx, placement, name),
				onCreated: (node) => startEditing(ctx, node.id)
			},
			preview
		);
		ctx.on('text-edit/stopped', (nodeId) => removeIfEmpty(ctx, nodeId));
		let pending: { id: string; point: { x: number; y: number } } | undefined;

		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'text',
					title: 'Text',
					icon: TextTIcon,
					shortcut: 'T',
					group: 'create',
					order: 13,
					cursor: 'text',
					overlay: { component: CreationPreviewOverlay, props: { preview } },
					onActivate: () => creation.onActivate?.(),
					onPointerDown(event: ToolPointerEvent): void {
						pending = undefined;
						if (event.button !== PRIMARY_BUTTON) return;
						const existing = textUnder(ctx, event.world);
						if (existing === undefined) {
							creation.onPointerDown?.(event);
							return;
						}
						pending = { id: existing, point: event.world };
					},
					onPointerMove: (event: ToolPointerEvent) => creation.onPointerMove?.(event),
					onPointerUp(event: ToolPointerEvent): void {
						if (!pending) {
							creation.onPointerUp?.(event);
							return;
						}
						const target = pending;
						pending = undefined;
						ctx.selection.select([target.id]);
						startEditing(ctx, target.id, target.point);
						ctx.tools.completeOperation();
					},
					onDeactivate: () => {
						pending = undefined;
						creation.onDeactivate?.();
					},
					onCancel(): boolean {
						if (pending) {
							pending = undefined;
							return true;
						}
						return creation.onCancel?.() === true;
					}
				}),
			'text tool'
		);
	}
};

function textUnder(ctx: Context, point: { x: number; y: number }): string | undefined {
	const tolerance = HIT_TOLERANCE_PX / ctx.viewport.zoom;
	for (const id of ctx.hitTest.all({ point, tolerance })) {
		const node = ctx.document.get(id);
		if (node && node.type === 'TEXT' && !node.locked) return id;
	}
	return undefined;
}

function buildTextNode(
	ctx: Context,
	placement: { transform: PositionedNode['transform']; width: number; height: number },
	name: string
): PositionedNode {
	const dragged = placement.width > 0;
	return createNode('TEXT', {
		name,
		transform: placement.transform,
		width: placement.width,
		height: placement.height,
		defaultStyle: defaultTextStyleFor(ctx),
		textAutoResize: dragged ? 'HEIGHT' : 'WIDTH_AND_HEIGHT'
	});
}

function startEditing(ctx: Context, id: string, point?: { x: number; y: number }): void {
	if (!ctx.commands.has('text.edit')) return;
	ctx.commands.run('text.edit', { id, point }).catch((error: unknown) => ctx.logger.error(error));
}

function removeIfEmpty(ctx: Context, nodeId: string): void {
	const node = ctx.document.get(nodeId);
	if (!node || node.type !== 'TEXT') return;
	if (plainText(node.paragraphs) !== '') return;
	ctx.document.apply(ctx.document.removeNode(nodeId), {
		origin: 'user',
		label: 'Delete empty text'
	});
	ctx.selection.clear();
}
