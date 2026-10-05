// Reactive holder behind the `recentFiles` service (a Service may not hold runes).

import type { LibraryFile } from '../../../electron/bridge';

export class RecentFilesState {
	/** Newest first, as main last reported them. */
	entries = $state.raw<readonly LibraryFile[]>([]);
}
