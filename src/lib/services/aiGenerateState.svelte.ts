// Reactive holder behind the `aiGenerate` service (a Service may not hold runes).

export class AiGenerateState {
	running = $state.raw(false);
	/** One line for the status toast: what the last generation did. */
	notice = $state.raw('');
}
