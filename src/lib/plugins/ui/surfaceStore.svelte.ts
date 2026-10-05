// The reactive state behind plugin surfaces: one entry per (plugin, surface id) holding the tree the
// plugin last sent, whether it is shown and, for a modal, its title and size. Entries are replaced
// wholesale (`$state.raw`), never edited, so a component that read one re-renders on the next put.

import type { SurfaceNode } from '../surface';

export interface ModalState {
	title: string;
	width: number;
	height: number;
}

export interface SurfaceEntry {
	key: string;
	pluginId: string;
	surfaceId: string;
	/** The plugin's tree; `null` until it sent one. */
	tree: SurfaceNode | null;
	/** Counts the full sets and patches received, so a patch can be matched to the tree it builds on. */
	version: number;
	visible: boolean;
	modal: ModalState | null;
}

export function surfaceKey(pluginId: string, surfaceId: string): string {
	return `${pluginId}\u0000${surfaceId}`;
}

export class SurfaceStore {
	entries = $state.raw<Readonly<Record<string, SurfaceEntry>>>({});

	get(pluginId: string, surfaceId: string): SurfaceEntry | undefined {
		return this.entries[surfaceKey(pluginId, surfaceId)];
	}

	put(entry: SurfaceEntry): void {
		this.entries = { ...this.entries, [entry.key]: entry };
	}

	remove(pluginId: string, surfaceId: string): void {
		const key = surfaceKey(pluginId, surfaceId);
		if (!(key in this.entries)) return;
		const next = { ...this.entries };
		delete next[key];
		this.entries = next;
	}

	/** Every entry, for the modal host and tests. */
	all(): SurfaceEntry[] {
		return Object.values(this.entries);
	}
}
