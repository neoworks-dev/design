// Keyboard handling shared by the handle gestures (resize, rotate, scale, shape handles): Esc
// aborts the running gesture before the keymap sees it, modifier changes re-plan it while the
// pointer rests. Capture phase on the window. Returns the inverse: listeners removed and any
// running gesture cancelled.

import type { Modifiers } from '../tools/protocol';

export interface KeyedGesture {
	readonly isActive: boolean;
	cancel(): void;
	refresh(modifiers: Modifiers): void;
}

const MODIFIER_KEYS = ['Shift', 'Alt', 'Control', 'Meta'];

export function watchGestureKeys(gestures: readonly KeyedGesture[]): () => void {
	const running = (): KeyedGesture | undefined => gestures.find((candidate) => candidate.isActive);
	const keydown = (event: KeyboardEvent): void => {
		const gesture = running();
		if (gesture === undefined) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			gesture.cancel();
			return;
		}
		if (MODIFIER_KEYS.includes(event.key)) gesture.refresh(event);
	};
	const keyup = (event: KeyboardEvent): void => {
		const gesture = running();
		if (gesture !== undefined && MODIFIER_KEYS.includes(event.key)) gesture.refresh(event);
	};
	window.addEventListener('keydown', keydown, true);
	window.addEventListener('keyup', keyup, true);
	return () => {
		for (const gesture of gestures) gesture.cancel();
		window.removeEventListener('keydown', keydown, true);
		window.removeEventListener('keyup', keyup, true);
	};
}
