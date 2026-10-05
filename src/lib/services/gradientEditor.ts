// The `gradientEditor` service: edits one gradient paint through a popover (type, stops, reverse,
// rotate) and on-canvas handles. The caller owns where the paint lives (fill, stroke) through the
// request; every edit goes back through `onchange`, so it is one `document.apply` per change.
//
//   ctx.gradientEditor.open({ anchor, nodeId, label: 'Fill gradient',
//   	paint: () => currentGradient(), onchange: (paint, gesture) => write(paint, gesture) })

import { Service, type Context } from '@neoworks/extension-system';
import type { GradientPaint, NodeId } from '../document/types';
import type { NumberGesture } from '../ui/numberField';
import type { GradientEditorState } from './gradientEditorState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		gradientEditor: GradientEditorService;
	}
}

export const GRADIENT_TOOL_ID = 'gradient-edit';

export interface GradientEditRequest {
	/** Screen rectangle of the swatch the popover opens from. */
	anchor: { x: number; y: number; width: number; height: number };
	label: string;
	/** The node the gradient belongs to; its box is where the handles sit. */
	nodeId: NodeId;
	/** Reactive getter; undefined when the paint is gone (the editor closes itself). */
	paint: () => GradientPaint | undefined;
	onchange: (paint: GradientPaint, gesture: NumberGesture) => void;
	onclose?: () => void;
}

export class GradientEditorService extends Service {
	constructor(
		ctx: Context,
		readonly state: GradientEditorState
	) {
		super(ctx, 'gradientEditor');
	}

	get isOpen(): boolean {
		return this.state.current !== null;
	}

	/** Opens the editor and switches to the handle tool; the disposer closes this request only. */
	open(request: GradientEditRequest): () => void {
		this.close();
		this.state.current = request;
		this.state.selectedStop = 0;
		this.ctx.tools.activate(GRADIENT_TOOL_ID);
		return () => {
			if (this.state.current === request) this.close();
		};
	}

	close(): void {
		const request = this.state.current;
		if (request === null) return;
		this.state.current = null;
		if (this.ctx.tools.activeId() === GRADIENT_TOOL_ID) this.ctx.tools.revertToDefault();
		request.onclose?.();
	}

	/** The paint being edited. */
	get paint(): GradientPaint | undefined {
		return this.state.current?.paint();
	}

	/** Replace the paint with `update(paint)`. */
	edit(update: (paint: GradientPaint) => GradientPaint, gesture: NumberGesture): void {
		const request = this.state.current;
		if (request === null) return;
		const paint = request.paint();
		if (paint === undefined) return;
		request.onchange(update(paint), gesture);
	}

	selectStop(index: number): void {
		this.state.selectedStop = index;
	}

	snapshotState(): Record<string, unknown> {
		return { open: this.state.current !== null };
	}
}
