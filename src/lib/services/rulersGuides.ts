// The `rulersGuides` service (#72): whether the rulers and the guides are shown, and the guide
// being dragged. The guides themselves are document data (`guides` on pages and frames, edited
// through `document.apply`); drawing and pointer handling live in lib/rulers.

import { Service, type Context } from '@neoworks/extension-system';
import type { GuideDraft, RulersGuidesState } from './rulersGuidesState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		rulersGuides: RulersGuidesService;
	}
}

export class RulersGuidesService extends Service {
	constructor(
		ctx: Context,
		private readonly state: RulersGuidesState
	) {
		super(ctx, 'rulersGuides');
	}

	get rulersVisible(): boolean {
		return this.state.rulersVisible;
	}

	get guidesVisible(): boolean {
		return this.state.guidesVisible;
	}

	/** The guide being dragged (reactive); null when none. */
	get draft(): GuideDraft | null {
		return this.state.draft;
	}

	setRulersVisible(visible: boolean): void {
		this.state.rulersVisible = visible;
	}

	setGuidesVisible(visible: boolean): void {
		this.state.guidesVisible = visible;
	}

	setDraft(draft: GuideDraft | null): void {
		this.state.draft = draft;
	}
}
