// Reactive holder behind the `aiReview` service (a Service may not hold runes).

export class AiReviewState {
	/** Whether finished runs wait for accept or reject. */
	enabled = $state.raw(false);
	/** Runs that changed the document and are waiting for a decision, oldest first. */
	waiting = $state.raw<readonly string[]>([]);
}
