// Reactive holder behind the `pluginManager` service (a Service may not hold runes).

import type { PluginSourceKind, ProjectTrust } from '../../../electron/bridge';

export class PluginManagerState {
	open = $state.raw(false);
	/** The plugin whose details are unfolded. */
	expandedId = $state.raw<string | null>(null);
	/** The project directory of the window and what the user decided about its plugins. */
	project = $state.raw<string | null>(null);
	projectTrust = $state.raw<ProjectTrust | null>(null);
	/** The last thing that went wrong or worked, for the dialog footer. */
	notice = $state.raw<{ text: string; error: boolean } | null>(null);
	/** A plugin file is being dragged over the dialog. */
	dragging = $state.raw(false);
	busy = $state.raw(false);
}

export type { PluginSourceKind };
