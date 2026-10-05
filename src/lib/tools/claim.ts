// Pointer claims: interactive overlay parts (resize handles, rulers) that sit on the canvas and
// take a press before the active tool sees it. The overlay draws them; the canvas input router
// hit-tests them through the claimants registered here.

import type { RegistryEntry } from '../registries/registry.svelte';
import type { ToolPointerEvent } from './protocol';

/** A press a claimant took: it receives the rest of the gesture instead of the tool. */
export interface PointerGrab {
	move(event: ToolPointerEvent): void;
	up(event: ToolPointerEvent): void;
	cancel(): void;
}

export interface PointerClaimant extends RegistryEntry {
	/** Returns the grab when the press hits this claimant's hit area. */
	claim(event: ToolPointerEvent): PointerGrab | undefined;
	/** The cursor while the pointer rests over this claimant's hit area. */
	cursorAt?(event: ToolPointerEvent): string | undefined;
}
