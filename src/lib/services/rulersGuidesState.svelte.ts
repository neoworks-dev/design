// Reactive holder behind the `rulersGuides` service (a Service may not hold runes).

import type { GuideRef } from '../rulers/guides';

/** A guide being dragged: a new one from a ruler, or an existing one that is moved. */
export interface GuideDraft {
	axis: 'X' | 'Y';
	/** Page coordinate of the line. */
	position: number;
	/** The pointer is over the ruler it came from: releasing deletes (or discards) the guide. */
	overRuler: boolean;
	/** The guide being moved; undefined for a new one. */
	moving?: GuideRef;
}

export class RulersGuidesState {
	rulersVisible = $state(false);
	guidesVisible = $state(true);
	draft = $state.raw<GuideDraft | null>(null);
}
