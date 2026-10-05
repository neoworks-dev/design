// The `colorPicker` service: opens the shared colour picker popover for fill, stroke, effects,
// gradient stops and styles. The popover edits through the request's callbacks, so the caller
// decides what a colour change means (one `document.apply` with a merge key per drag).
//
//   const close = ctx.colorPicker.open({ anchor, label: 'Fill colour', scope: 'FILL',
//   	color: () => paint.color, onchange: (color, gesture) => ... })

import { Service, type Context } from '@neoworks/extension-system';
import type { RGBA, Variable } from '../document/types';
import type { NumberGesture } from '../ui/numberField';
import type { ColorPickerState } from './colorPickerState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		colorPicker: ColorPickerService;
	}
}

export type ColorScope = 'FILL' | 'STROKE' | 'EFFECT';

export interface ColorPickerRequest {
	/** Screen rectangle of the swatch the popover opens from. */
	anchor: { x: number; y: number; width: number; height: number };
	label: string;
	/** Which variable scopes may be bound; absent allows every colour variable. */
	scope?: ColorScope;
	/** Reactive getter, so the popover follows edits as they land in the document. */
	color: () => RGBA;
	onchange: (color: RGBA, gesture: NumberGesture) => void;
	/** Reactive getter for the bound variable, if any. */
	variableId?: () => string | undefined;
	onbind?: (variableId: string | null) => void;
	onclose?: () => void;
}

const SCOPES_FOR: Record<ColorScope, string[]> = {
	FILL: ['ALL_SCOPES', 'ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL'],
	STROKE: ['ALL_SCOPES', 'STROKE_COLOR'],
	EFFECT: ['ALL_SCOPES', 'EFFECT_COLOR']
};

/** Colour variables whose scopes allow `scope`; an empty scope list allows everything. */
export function variablesForScope(
	variables: readonly Variable[],
	scope: ColorScope | undefined
): Variable[] {
	return variables.filter((variable) => {
		if (variable.resolvedType !== 'COLOR') return false;
		if (scope === undefined || variable.scopes.length === 0) return true;
		return variable.scopes.some((candidate) => SCOPES_FOR[scope].includes(candidate));
	});
}

export class ColorPickerService extends Service {
	constructor(
		ctx: Context,
		readonly state: ColorPickerState
	) {
		super(ctx, 'colorPicker');
	}

	/** Reactive: whether a picker is open. */
	get isOpen(): boolean {
		return this.state.current !== null;
	}

	/** Opens the popover (closing a previous one); the disposer closes this request only. */
	open(request: ColorPickerRequest): () => void {
		this.close();
		this.state.current = request;
		return () => {
			if (this.state.current === request) this.close();
		};
	}

	close(): void {
		const request = this.state.current;
		if (request === null) return;
		this.state.remember(request.color());
		this.state.current = null;
		request.onclose?.();
	}

	snapshotState(): Record<string, unknown> {
		return { open: this.state.current !== null };
	}
}
