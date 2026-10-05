// Reactive holder behind the `ai` service (a Service may not hold runes).

import type { AiProviderInfo } from '../../../electron/bridge';
import type { AiRunRecord } from '../ai/types';

/** The agent session main holds for this window, and what it was started with. */
export interface AiSessionRef {
	sessionId: string;
	provider: string;
	model: string | null;
	toolSignature: string;
	documentId: string;
}

export class AiState {
	/** Every run since the app started, oldest first. */
	runs = $state.raw<AiRunRecord[]>([]);
	/** Documents the user allowed to be sent to a model. */
	consented = $state.raw<readonly string[]>([]);
	providers = $state.raw<AiProviderInfo[]>([]);
	/** The provider and model the next run uses; empty provider means "first available". */
	providerId = $state.raw('');
	modelId = $state.raw('');
	session: AiSessionRef | null = null;
}
