import type { BoxSize } from './resize';
import type { ResizeFeedback } from './resizeGesture';
import type { RotateFeedback } from './rotateGesture';

/**
 * What the handles overlay shows while a resize or rotation runs (the size pill, the angle
 * readout). Not a Service: runes are fine.
 */
export class ResizeFeedbackState implements ResizeFeedback, RotateFeedback {
	size = $state.raw<BoxSize | null>(null);
	angle = $state.raw<number | null>(null);
}
