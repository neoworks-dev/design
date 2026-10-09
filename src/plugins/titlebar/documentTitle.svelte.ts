// Document title and save status. The file session publishes the context keys `document.title`,
// `document.renamable` (a file is open), `document.saving` (autosave has work) and
// `document.saveError` (the last send failed; it keeps retrying); the titlebar only reads them, so
// it never imports the session plugin.

import type { ContextKeysService } from '../../lib/registries/contextKeys.svelte';

export const DEFAULT_DOCUMENT_TITLE = 'Untitled';
const APP_NAME = 'Draftboard';

export function documentTitleOf(contextKeys: ContextKeysService): string {
	const title = contextKeys.get('document.title');
	if (typeof title === 'string' && title.length > 0) return title;
	return DEFAULT_DOCUMENT_TITLE;
}

export function isDocumentRenamable(contextKeys: ContextKeysService): boolean {
	return contextKeys.get('document.renamable') === true;
}

export function isDocumentSaving(contextKeys: ContextKeysService): boolean {
	return contextKeys.get('document.saving') === true;
}

/** Why the last autosave failed, or `null` while saving works. */
export function documentSaveErrorOf(contextKeys: ContextKeysService): string | null {
	const error = contextKeys.get('document.saveError');
	if (typeof error === 'string' && error.length > 0) return error;
	return null;
}

export function isRenamingTitle(contextKeys: ContextKeysService): boolean {
	return contextKeys.get('titlebar.renaming') === true;
}

/** The OS window title (task switchers, window lists): `title - Draftboard`. */
export function windowTitleOf(contextKeys: ContextKeysService): string {
	if (!isDocumentRenamable(contextKeys)) return APP_NAME;
	return `${documentTitleOf(contextKeys)} - ${APP_NAME}`;
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
