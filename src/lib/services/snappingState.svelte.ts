// Reactive holder behind the `snapping` service (a Service may not hold runes). The overlay layer
// (#38) draws whatever is in here: guides while a snap is active, nothing otherwise.

import type { Measurement } from '../snapping/measure';
import type { SnapGuide } from '../snapping/snap';
import type { GapGuide } from '../snapping/spacing';

export class SnappingState {
	/** Global switch ("Snap to objects"); Ctrl/Cmd held while dragging bypasses it per call. */
	enabled = $state(true);
	/** Guides of the snap that is active right now; empty when nothing snaps or after release. */
	guides = $state.raw<readonly SnapGuide[]>([]);
	/** Equal-spacing brackets of the active snap. */
	gaps = $state.raw<readonly GapGuide[]>([]);
	/** Alt+hover distances; null when nothing is being measured. */
	measurement = $state.raw<Measurement | null>(null);
}
