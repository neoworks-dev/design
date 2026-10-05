// Reactive holder behind the `aiSearch` service (a Service may not hold runes).

export class AiSearchState {
	asking = $state.raw(false);
	notice = $state.raw('');
	/** The query a run in flight was started for. */
	pendingQuery = $state.raw('');
	/** What the model reported, and for which query. */
	aiQuery = $state.raw('');
	aiIds = $state.raw<readonly string[]>([]);
}
