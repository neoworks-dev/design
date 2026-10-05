// Reactive holder behind the `settings` service (a Service may not hold runes).

import type { StandardSchemaV1 } from '@neoworks/extension-system';
import type { SettingsData } from '../../../electron/bridge';

export class SettingsState {
	/** What the user changed, as stored on disk. */
	data = $state.raw<SettingsData>({ core: {}, plugins: {} });
	/** Whether the stored preferences were read and applied yet. */
	loaded = $state.raw(false);
	/** Schema of the app's own (bare-key) settings; `null` until the settings plugin set it. */
	coreSchema = $state.raw<StandardSchemaV1 | null>(null);
	dialogOpen = $state.raw(false);
	/** The last failed save, for the dialog footer; `null` when the disk is in step. */
	saveError = $state.raw<string | null>(null);
}
