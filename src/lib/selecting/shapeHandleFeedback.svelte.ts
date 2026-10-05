import type { Point } from '../tools/protocol';
import type { ShapeHandleFeedback } from './shapeHandleGesture';

/** The readout next to a dragged shape handle. Not a Service: runes are fine. */
export class ShapeHandleFeedbackState implements ShapeHandleFeedback {
	readout = $state.raw<{ text: string; world: Point } | null>(null);
}
