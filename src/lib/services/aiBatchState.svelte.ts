// Reactive holder behind the `aiBatch` service (a Service may not hold runes).

export class AiBatchState {
	running = $state.raw(false);
	/** One line for the toast: what the last batch did, or why it did not start. */
	notice = $state.raw('');
}
