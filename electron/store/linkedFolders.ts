// The directories outside the library the user added to the sidebar: a small JSON file under the
// app data directory (`{ id, name, path }` per entry), written atomically like the recent list.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const LINKED_FOLDERS_NAME = 'linked-folders.json';

export interface LinkedFolderEntry {
	id: string;
	name: string;
	path: string;
}

function isEntry(value: unknown): value is LinkedFolderEntry {
	if (typeof value !== 'object' || value === null) return false;
	return (
		typeof Reflect.get(value, 'id') === 'string' &&
		typeof Reflect.get(value, 'name') === 'string' &&
		typeof Reflect.get(value, 'path') === 'string'
	);
}

export class LinkedFoldersStore {
	constructor(private readonly storePath: string) {}

	list(): LinkedFolderEntry[] {
		let text: string;
		try {
			text = readFileSync(this.storePath, 'utf8');
		} catch {
			return [];
		}
		try {
			const parsed: unknown = JSON.parse(text);
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(isEntry);
		} catch {
			return [];
		}
	}

	/** Add `directory`; linking the same directory twice returns the existing entry. */
	add(directory: string): LinkedFolderEntry {
		const resolved = path.resolve(directory);
		const entries = this.list();
		const existing = entries.find((entry) => entry.path === resolved);
		if (existing !== undefined) return existing;
		const entry = {
			id: randomBytes(6).toString('hex'),
			name: path.basename(resolved),
			path: resolved
		};
		this.write([...entries, entry]);
		return entry;
	}

	remove(id: string): void {
		this.write(this.list().filter((entry) => entry.id !== id));
	}

	private write(entries: LinkedFolderEntry[]): void {
		mkdirSync(path.dirname(this.storePath), { recursive: true });
		const staging = `${this.storePath}.tmp`;
		writeFileSync(staging, JSON.stringify(entries, null, '\t'));
		renameSync(staging, this.storePath);
	}
}
