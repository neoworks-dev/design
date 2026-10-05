// Reactive holder behind the `aiRename` service (a Service may not hold runes).

export class AiRenameState {
	running = $state.raw(false);
	/** One line for the toast: what the last rename did, or why it could not start. */
	notice = $state.raw('');
	/** The selection (ids joined) whose "Missing names" hint the user closed. */
	dismissedFor = $state.raw('');
}
