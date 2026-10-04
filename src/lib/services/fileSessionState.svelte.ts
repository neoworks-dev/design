// Reactive holder behind the `fileSession` service (a Service may not hold runes).

import type { StoreInfo } from '../../../electron/bridge';
import type { AutosaveStatus } from './autosaveQueue';

export const IDLE_STATUS: AutosaveStatus = { queued: 0, inFlight: 0, error: null, persisted: 0 };

export class FileSessionState {
	/** The file this window edits; `null` while no file is attached (boot, between files). */
	info = $state.raw<StoreInfo | null>(null);
	/** Autosave progress: what is queued, in flight, failed. */
	status = $state.raw<AutosaveStatus>(IDLE_STATUS);
	/**
	 * Document revision at the last Save (or at open). Dirty means the revision moved since;
	 * `-1` marks a file that was opened with edits nobody ever saved (a recovered one).
	 */
	savedRevision = $state.raw(-1);
}
