// Reactive state behind the `fonts` service (services themselves hold no `$state`): the faces of
// each source, and whether the system list has arrived yet.

import type { FontEntry, FontRef } from './resolve';
import { sameFace } from './resolve';

export class FontsState {
	system = $state.raw<readonly FontEntry[]>([]);
	embedded = $state.raw<readonly FontEntry[]>([]);
	/** True once the system list was fetched; until then every non-bundled font looks missing. */
	ready = $state(false);

	setSystem(refs: readonly FontRef[]): void {
		this.system = refs.map((ref) => ({ family: ref.family, style: ref.style, source: 'system' }));
		this.ready = true;
	}

	/** Add an embedded face (replacing one with the same name); returns the remover for this entry. */
	addEmbedded(ref: FontRef): () => void {
		const entry: FontEntry = { family: ref.family, style: ref.style, source: 'embedded' };
		this.embedded = [...this.embedded.filter((existing) => !sameFace(existing, ref)), entry];
		return () => {
			this.embedded = this.embedded.filter((existing) => existing !== entry);
		};
	}
}
