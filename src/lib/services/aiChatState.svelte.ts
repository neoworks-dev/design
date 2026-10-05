// Reactive holder behind the `aiChat` service (a Service may not hold runes).

export class AiChatState {
	draft = $state.raw('');
	/** Send the current selection along with the next prompt. */
	attachSelection = $state.raw(false);
	/** Row keys the user opened (Reasoning, tool calls). */
	expanded = $state.raw<readonly string[]>([]);
	/** The last send was held back until the document is allowed to go to a model. */
	awaitingConsent = $state.raw(false);
}
