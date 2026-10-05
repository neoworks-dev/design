// Reactive holder behind the `versionHistory` service (a Service may not hold runes).

import type { VersionHistoryData } from '../../../electron/bridge';

export interface VersionNotice {
	kind: 'info' | 'error';
	text: string;
}

export class VersionHistoryState {
	data = $state.raw<VersionHistoryData | null>(null);
	loading = $state.raw(false);
	/** A restore or a save is running. */
	busy = $state.raw(false);
	notice = $state.raw<VersionNotice | null>(null);
}
