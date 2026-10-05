// Reactive holder behind the `home` service (a Service may not hold runes).

import type { EntryFilter, HomeEntry, HomeSection, HomeSort } from '../home/entries';

export type HomeView = 'grid' | 'list';

export class HomeState {
	/** The user asked for the home screen (button, command) while a document is open. */
	shown = $state.raw(false);
	entries = $state.raw<HomeEntry[]>([]);
	loaded = $state.raw(false);
	section = $state.raw<HomeSection>('recents');
	view = $state.raw<HomeView>('grid');
	sort = $state.raw<HomeSort>('recent');
	query = $state.raw('');

	get filter(): EntryFilter {
		return { section: this.section, query: this.query, sort: this.sort };
	}
}
