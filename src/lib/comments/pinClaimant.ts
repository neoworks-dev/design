// A press on a comment pin opens its note, whichever tool is active: a pointer claimant, so the
// canvas input router (not a DOM hit area) decides who gets a press and the pins can stay drawn on
// the overlay. Ranks above the tools so a pin on top of a shape is the thing that is clicked.

import type { Context } from '@neoworks/extension-system';
import type { PointerClaimant, PointerGrab } from '../tools/claim';
import type { ToolPointerEvent } from '../tools/protocol';

const PRIMARY_BUTTON = 0;

export class PinClaimant implements PointerClaimant {
	readonly id = 'comments/pins';
	readonly order = -5;

	constructor(private readonly ctx: Context) {}

	claim(event: ToolPointerEvent): PointerGrab | undefined {
		if (event.button !== PRIMARY_BUTTON) return undefined;
		const pin = this.pinUnder(event);
		if (pin === undefined) return undefined;
		return {
			move: () => {},
			up: () => this.ctx.comments.openEditor(pin),
			cancel: () => {}
		};
	}

	cursorAt(event: ToolPointerEvent): string | undefined {
		if (this.pinUnder(event) === undefined) return undefined;
		return 'pointer';
	}

	private pinUnder(event: ToolPointerEvent): string | undefined {
		const comments = this.ctx.comments;
		if (!comments.visible) return undefined;
		return comments.pinAt(event.screen)?.id;
	}
}
