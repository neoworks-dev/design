// Reactive holder behind the `fileSession` service (a Service may not hold runes).

import type { StoreInfo } from '../../../electron/bridge';
import type { AutosaveStatus } from './autosaveQueue';

export const IDLE_STATUS: AutosaveStatus = { queued: 0, inFlight: 0, error: null, persisted: 0 };

export class FileSessionState {
	/** The file this window edits; `null` while no file is attached (boot, between files). */
	info = $state.raw<StoreInfo | null>(null);
	/** Autosave progress: what is queued, in flight, failed. */
	status = $state.raw<AutosaveStatus>(IDLE_STATUS);
	/** The window shows no document on purpose (the last tab was closed): the home screen. */
	closed = $state.raw(false);
}
