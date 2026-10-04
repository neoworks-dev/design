// Keeps a popup on screen. Runs after the popup is in the DOM, when its size is known.

import type { Action } from 'svelte/action';

const VIEWPORT_MARGIN = 4;

export type PlacementMode = 'popup' | 'submenu';

/** A popup positioned with `left`/`top` (client space): clamp it inside the viewport. */
function keepPopupInViewport(element: HTMLElement): void {
	const rect = element.getBoundingClientRect();
	const maxLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN;
	const maxTop = window.innerHeight - rect.height - VIEWPORT_MARGIN;
	if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
		element.style.left = `${Math.max(VIEWPORT_MARGIN, maxLeft)}px`;
	}
	if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
		element.style.top = `${Math.max(VIEWPORT_MARGIN, maxTop)}px`;
	}
}

/** A submenu opens to the right of its item; flip to the left when there is no room. */
function flipSubmenu(element: HTMLElement): void {
	const rect = element.getBoundingClientRect();
	if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
		element.style.left = 'auto';
		element.style.right = '100%';
	}
	const overflow = rect.bottom - (window.innerHeight - VIEWPORT_MARGIN);
	if (overflow > 0) element.style.top = `${-overflow}px`;
}

export const placeWithinViewport: Action<HTMLElement, PlacementMode> = (element, mode) => {
	if (mode === 'submenu') flipSubmenu(element);
	else keepPopupInViewport(element);
};
