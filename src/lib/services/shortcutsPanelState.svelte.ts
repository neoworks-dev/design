// Reactive holder behind the `shortcutsPanel` service (a Service may not hold runes).

import type { KeyScope } from '../registries/keymap.svelte';

/** The chord being recorded: the next key press becomes this command's binding in `scope`. */
export interface Recording {
	commandId: string;
	scope: KeyScope;
}

/** A recorded chord another command already uses; waits for Replace or Cancel. */
export interface PendingConflict {
	commandId: string;
	scope: KeyScope;
	/** The chord as `rebind` accepts it. */
	key: string;
	display: string;
	/** Titles of the commands that hold it now. */
	holders: string[];
}

export class ShortcutsPanelState {
	isOpen = $state.raw(false);
	query = $state.raw('');
	recording = $state.raw<Recording | null>(null);
	conflict = $state.raw<PendingConflict | null>(null);
}
