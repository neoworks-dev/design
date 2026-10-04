import type { BoxSize } from './resize';
import type { ResizeFeedback } from './resizeGesture';

/** What the handles overlay shows while a resize runs (the size pill). Not a Service: runes are fine. */
export class ResizeFeedbackState implements ResizeFeedback {
	size = $state.raw<BoxSize | null>(null);
}
