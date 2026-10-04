// Untitled documents live as SQLite files in `<userData>/untitled/` until the user saves them
// somewhere (data-model.md section 7). Anything still in that directory at startup is what a
// crash or a quit left behind, and is offered for recovery.

import path from 'node:path';

export const UNTITLED_DIRECTORY_NAME = 'untitled';

export function untitledDirectory(userData: string): string {
	return path.join(userData, UNTITLED_DIRECTORY_NAME);
}

export function isUntitledPath(userData: string, file: string): boolean {
	return path.dirname(path.resolve(file)) === path.resolve(untitledDirectory(userData));
}
