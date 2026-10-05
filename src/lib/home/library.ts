// What the home screen lists and how: sorting, the location a file shows under, breadcrumbs and
// move destinations. Pure functions over the bridge's library types, so the rules are testable
// without the UI.

import type {
	LibraryFile,
	LibraryFolder,
	LibraryOverview,
	LinkedFolder
} from '../../../electron/bridge';

export type HomeSort = 'edited' | 'opened' | 'name';

/** Recents, or the files of one directory (the library root is "Drafts"). */
export type HomeLocation = { kind: 'recents' } | { kind: 'directory'; path: string };

export interface Breadcrumb {
	label: string;
	/** The directory a click goes to. */
	path: string;
}

export interface MoveDestination {
	label: string;
	directory: string;
}

export const DRAFTS_LABEL = 'Drafts';

function openedOrEdited(file: LibraryFile): number {
	if (file.openedAt === null) return file.modifiedAt;
	return file.openedAt;
}

/** A copy of `files` in the order `sort` asks for. */
export function sortFiles(files: readonly LibraryFile[], sort: HomeSort): LibraryFile[] {
	const sorted = [...files];
	if (sort === 'name') return sorted.sort((a, b) => a.name.localeCompare(b.name));
	if (sort === 'opened') return sorted.sort((a, b) => openedOrEdited(b) - openedOrEdited(a));
	return sorted.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function sortFolders(folders: readonly LibraryFolder[]): LibraryFolder[] {
	return [...folders].sort((a, b) => a.name.localeCompare(b.name));
}

/** The directory part of a file or folder path, for either separator. */
export function directoryOf(path: string): string {
	const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	if (separator <= 0) return '';
	return path.slice(0, separator);
}

function isInside(path: string, directory: string): boolean {
	return path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`);
}

function linkedFolderContaining(overview: LibraryOverview, path: string): LinkedFolder | undefined {
	return overview.linked.find((linked) => path === linked.path || isInside(path, linked.path));
}

/** Whether `path` is the library root or one of its folders (as opposed to a linked directory). */
export function isLibraryDirectory(overview: LibraryOverview, path: string): boolean {
	if (path === overview.root) return true;
	return overview.folders.some((folder) => folder.path === path);
}

/** The header trail of a directory: "Drafts", a folder, or a linked folder and a subdirectory. */
export function breadcrumbsOf(overview: LibraryOverview, path: string): Breadcrumb[] {
	if (path === overview.root) return [{ label: DRAFTS_LABEL, path }];
	const folder = overview.folders.find((candidate) => candidate.path === path);
	if (folder !== undefined) return [{ label: folder.name, path }];
	const linked = linkedFolderContaining(overview, path);
	if (linked === undefined) return [{ label: path, path }];
	const trail: Breadcrumb[] = [{ label: linked.name, path: linked.path }];
	if (path === linked.path) return trail;
	const relative = path.slice(linked.path.length + 1);
	let walked = linked.path;
	for (const segment of relative.split(/[\\/]/)) {
		walked = `${walked}/${segment}`;
		trail.push({ label: segment, path: walked });
	}
	return trail;
}

/** Where a file lives, in words: "Drafts", a folder name, "Linked / sub", "Elsewhere". */
export function locationLabel(file: LibraryFile, overview: LibraryOverview | null): string {
	const location = file.location;
	if (location.kind === 'external') return 'Elsewhere';
	if (location.kind === 'library') {
		if (location.folder === '') return DRAFTS_LABEL;
		return location.folder;
	}
	const linked = overview?.linked.find((candidate) => candidate.id === location.linkedId);
	const root = linked === undefined ? 'Linked folder' : linked.name;
	if (location.folder === '') return root;
	return `${root} / ${location.folder}`;
}

/** Everywhere a file can be moved to: the library root, its folders, the available linked folders. */
export function moveDestinations(overview: LibraryOverview): MoveDestination[] {
	const destinations: MoveDestination[] = [{ label: DRAFTS_LABEL, directory: overview.root }];
	for (const folder of sortFolders(overview.folders)) {
		destinations.push({ label: folder.name, directory: folder.path });
	}
	for (const linked of overview.linked) {
		if (!linked.available) continue;
		destinations.push({ label: linked.name, directory: linked.path });
	}
	return destinations;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function plural(count: number, unit: string): string {
	if (count === 1) return `1 ${unit} ago`;
	return `${count} ${unit}s ago`;
}

/** Like `relativeTime` but in months and years instead of a date: "2 months ago". */
export function relativeAge(timestamp: number, now: number): string {
	const age = Math.max(0, now - timestamp);
	if (age < MINUTE) return 'just now';
	if (age < HOUR) return plural(Math.floor(age / MINUTE), 'minute');
	if (age < DAY) return plural(Math.floor(age / HOUR), 'hour');
	if (age < MONTH) return plural(Math.floor(age / DAY), 'day');
	if (age < YEAR) return plural(Math.floor(age / MONTH), 'month');
	return plural(Math.floor(age / YEAR), 'year');
}
