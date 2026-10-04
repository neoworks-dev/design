// The list of recently opened documents: a small JSON file under the app data directory. Entries
// are `{ path, name, openedAt }`, newest first, capped. Missing files are pruned when the list is
// read, not on a timer, so a drive that is merely unplugged costs nothing until someone looks.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RECENT_FILES_CAP = 20;
export const RECENT_FILES_NAME = 'recent-files.json';

export interface RecentEntry {
	path: string;
	name: string;
	openedAt: number;
}

function isEntry(value: unknown): value is RecentEntry {
	if (typeof value !== 'object' || value === null) return false;
	return (
		typeof Reflect.get(value, 'path') === 'string' &&
		typeof Reflect.get(value, 'name') === 'string' &&
		typeof Reflect.get(value, 'openedAt') === 'number'
	);
}

export class RecentFilesStore {
	constructor(
		private readonly storePath: string,
		private readonly cap: number = RECENT_FILES_CAP
	) {}

	/** Move `file` to the front (adding it when new) and drop what exceeds the cap. */
	record(file: string, name: string, now = Date.now()): RecentEntry[] {
		const resolved = path.resolve(file);
		const others = this.read().filter((entry) => entry.path !== resolved);
		const entries = [{ path: resolved, name, openedAt: now }, ...others].slice(0, this.cap);
		this.write(entries);
		return entries;
	}

	/** The list, newest first, without files that no longer exist (the store is rewritten then). */
	list(): RecentEntry[] {
		const entries = this.read();
		const present = entries.filter((entry) => existsSync(entry.path));
		if (present.length !== entries.length) this.write(present);
		return present;
	}

	clear(): void {
		this.write([]);
	}

	private read(): RecentEntry[] {
		let text: string;
		try {
			text = readFileSync(this.storePath, 'utf8');
		} catch {
			return [];
		}
		try {
			const parsed: unknown = JSON.parse(text);
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(isEntry).slice(0, this.cap);
		} catch {
			return [];
		}
	}

	private write(entries: RecentEntry[]): void {
		mkdirSync(path.dirname(this.storePath), { recursive: true });
		const staging = `${this.storePath}.tmp`;
		writeFileSync(staging, JSON.stringify(entries, null, '\t'));
		renameSync(staging, this.storePath);
	}
}
