// Reactive holder behind the `home` service (a Service may not hold runes).

import type { LibraryFile, LibraryFolder, LibraryOverview } from '../../../electron/bridge';
import type { HomeLocation, HomeSort } from '../home/library';

export type HomeView = 'grid' | 'list';

/** Something the user asked to move to the trash, waiting for the confirmation. */
export interface PendingTrash {
	kind: 'file' | 'folder';
	path: string;
	name: string;
}

export class HomeState {
	/** The user asked for the home screen (button, command) while a document is open. */
	shown = $state.raw(false);
	/** The sidebar's data (folders, linked folders) came in at least once. */
	loaded = $state.raw(false);
	overview = $state.raw<LibraryOverview | null>(null);
	location = $state.raw<HomeLocation>({ kind: 'recents' });
	/** The files of the location: the recent list or the directory's design files. */
	files = $state.raw<LibraryFile[]>([]);
	/** Subdirectories of the shown directory. */
	folders = $state.raw<LibraryFolder[]>([]);
	view = $state.raw<HomeView>('grid');
	sort = $state.raw<HomeSort>('opened');
	query = $state.raw('');
	/** Files matching the query; `null` while the query is empty. */
	results = $state.raw<LibraryFile[] | null>(null);
	/** The sidebar shows the new-folder name input. */
	creatingFolder = $state.raw(false);
	/** The file or folder whose name is being edited in place. */
	renamingPath = $state.raw<string | null>(null);
	pendingTrash = $state.raw<PendingTrash | null>(null);
	/** The file a context menu was opened for; its "Move to" items act on it. */
	menuFilePath = $state.raw<string | null>(null);
}
