// One undo step per plugin run. A run (a command, a UI event) opens a history group; every
// transaction the plugin applies during it carries the group's run id and folds into it, so one
// undo reverts the whole run (CLAUDE.md: "a whole plugin or AI run is one undo step").
// `commitUndo()` closes the group and opens the next with a fresh run id, which is how a plugin
// makes the changes it applies afterwards a separate step.

import type { HistoryService, GroupHandle } from '../../services/history';
import type { PluginRun, RunScope } from '../connection';

declare module '@neoworks/extension-system' {
	interface Context {
		/** One undo step per plugin run; provided by `plugin-api`, used by APIs that write. */
		pluginUndo: PluginUndo;
	}
}

interface RunState {
	handle: GroupHandle;
	runId: string;
	label: string;
	commits: number;
}

export class PluginUndo {
	private readonly states = new WeakMap<PluginRun, RunState>();

	constructor(private readonly history: HistoryService) {}

	/** Register with `pluginHost.registerRunScope`. */
	readonly scope: RunScope = async (run, body) => {
		const state = this.open(run.label, run.id);
		this.states.set(run, state);
		try {
			return await body();
		} finally {
			this.history.endGroup(state.handle);
		}
	};

	/** The run id the plugin's transactions must carry so they join the open group. */
	runIdFor(run: PluginRun | null): string | undefined {
		if (run === null) return undefined;
		return this.states.get(run)?.runId;
	}

	/** Close the current step and start a new one. Does nothing outside a run. */
	commit(run: PluginRun | null): void {
		if (run === null) return;
		const state = this.states.get(run);
		if (state === undefined) return;
		this.history.endGroup(state.handle);
		state.commits += 1;
		const next = this.open(state.label, `${run.id}#${state.commits}`);
		state.handle = next.handle;
		state.runId = next.runId;
	}

	private open(label: string, runId: string): RunState {
		const handle = this.history.beginGroup({ label, origin: 'plugin', runId });
		return { handle, runId, label, commits: 0 };
	}
}
