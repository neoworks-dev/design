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

/**
 * A submenu opens to the right of its item; flip to the left when there is no room. It is
 * `position: fixed` against the item's rect, because the parent list scrolls and would clip it.
 */
function placeSubmenu(element: HTMLElement): void {
	const anchor = element.parentElement?.getBoundingClientRect();
	if (!anchor) return;
	const rect = element.getBoundingClientRect();
	let left = anchor.right;
	if (left + rect.width > window.innerWidth - VIEWPORT_MARGIN) left = anchor.left - rect.width;
	const maxTop = window.innerHeight - rect.height - VIEWPORT_MARGIN;
	element.style.left = `${Math.max(VIEWPORT_MARGIN, left)}px`;
	element.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.top, maxTop))}px`;
}

export const placeWithinViewport: Action<HTMLElement, PlacementMode> = (element, mode) => {
	if (mode === 'submenu') placeSubmenu(element);
	else keepPopupInViewport(element);
};
