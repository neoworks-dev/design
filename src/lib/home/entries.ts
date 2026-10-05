// What the home screen lists: recent files and drafts as one entry shape, filtered by the search
// text and sorted. Pure functions, so the rules are testable without the UI.

import type { DraftFile, RecentFile, Thumbnail } from '../../../electron/bridge';

export type HomeSection = 'recents' | 'drafts' | 'all';
export type HomeSort = 'recent' | 'name';

export interface HomeEntry {
	kind: 'recent' | 'draft';
	path: string;
	name: string;
	/** When the file was last opened (recents) or changed (drafts), milliseconds since the epoch. */
	timestamp: number;
	thumbnail: Thumbnail | null;
}

export function entryOfRecent(file: RecentFile): HomeEntry {
	return {
		kind: 'recent',
		path: file.path,
		name: file.name,
		timestamp: file.openedAt,
		thumbnail: file.thumbnail
	};
}

export function entryOfDraft(draft: DraftFile): HomeEntry {
	return {
		kind: 'draft',
		path: draft.path,
		name: draft.name,
		timestamp: draft.modifiedAt,
		thumbnail: draft.thumbnail
	};
}

function inSection(entry: HomeEntry, section: HomeSection): boolean {
	if (section === 'all') return true;
	if (section === 'recents') return entry.kind === 'recent';
	return entry.kind === 'draft';
}

function matchesQuery(entry: HomeEntry, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === '') return true;
	return entry.name.toLowerCase().includes(needle);
}

function compare(sort: HomeSort): (left: HomeEntry, right: HomeEntry) => number {
	if (sort === 'name') return (left, right) => left.name.localeCompare(right.name);
	return (left, right) => right.timestamp - left.timestamp;
}

export interface EntryFilter {
	section: HomeSection;
	query: string;
	sort: HomeSort;
}

/** The entries to show: in the section, matching the search text, sorted. A path is listed once. */
export function visibleEntries(entries: readonly HomeEntry[], filter: EntryFilter): HomeEntry[] {
	const seen = new Set<string>();
	const shown: HomeEntry[] = [];
	for (const entry of entries) {
		if (!inSection(entry, filter.section)) continue;
		if (!matchesQuery(entry, filter.query)) continue;
		if (seen.has(entry.path)) continue;
		seen.add(entry.path);
		shown.push(entry);
	}
	return shown.sort(compare(filter.sort));
}
