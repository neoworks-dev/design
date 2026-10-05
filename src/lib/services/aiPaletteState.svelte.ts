// Reactive holder behind the `aiPalette` service (a Service may not hold runes).

export class AiPaletteState {
	running = $state.raw(false);
	/** The answer shown in the toast after a request. */
	answer = $state.raw('');
}
