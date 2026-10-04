// Document title and dirty marker. The file session (later issue) publishes the context keys
// `document.title` and `document.dirty`; the titlebar only reads them, so it never imports the
// session plugin.

import type { ContextKeysService } from '../../lib/registries/contextKeys.svelte';

export const DEFAULT_DOCUMENT_TITLE = 'Untitled';
const APP_NAME = 'Neoworks Design';

export function documentTitleOf(contextKeys: ContextKeysService): string {
	const title = contextKeys.get('document.title');
	if (typeof title === 'string' && title.length > 0) return title;
	return DEFAULT_DOCUMENT_TITLE;
}

export function isDocumentDirty(contextKeys: ContextKeysService): boolean {
	return contextKeys.get('document.dirty') === true;
}

/** The OS window title (task switchers, window lists): `• title - App` while dirty. */
export function windowTitleOf(contextKeys: ContextKeysService): string {
	const base = `${documentTitleOf(contextKeys)} - ${APP_NAME}`;
	if (isDocumentDirty(contextKeys)) return `• ${base}`;
	return base;
}

/**
 * Keep `document.title` in sync with the context keys. Returns the stop function that also
 * restores the previous title; run it inside `ctx.effect`.
 */
export function bindWindowTitle(contextKeys: ContextKeysService): () => void {
	const previous = document.title;
	const stop = $effect.root(() => {
		$effect(() => {
			document.title = windowTitleOf(contextKeys);
		});
	});
	return () => {
		stop();
		document.title = previous;
	};
}
