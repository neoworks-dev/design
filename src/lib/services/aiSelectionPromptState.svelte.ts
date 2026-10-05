// Reactive holder behind the `aiSelectionPrompt` service (a Service may not hold runes).

import type { NodeId } from '../document';

export class AiSelectionPromptState {
	/** The prompt card is open. */
	open = $state.raw(false);
	draft = $state.raw('');
	/** What was selected when the card opened; the card stays next to these while it is open. */
	anchorIds = $state.raw<readonly NodeId[]>([]);
	/** The run the card started, shown in the card until it closes. */
	runId = $state.raw<string | null>(null);
}
