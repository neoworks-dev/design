// Pure grouping of toolbar tools into slots (one button each). Tools sharing a `toolbarGroup`
// share a slot, positioned where its first member (by `order`) sits; every other tool is its own.

import type { ToolEntry } from '../../lib/registries/tools.svelte';

export interface ToolbarSlot {
	/** The `toolbarGroup`, or `tool:<id>` for a tool that stands alone. */
	id: string;
	/** Members in registry order. */
	entries: readonly ToolEntry[];
	/** Present for dropdown groups. */
	group: string | undefined;
}

interface MutableSlot {
	id: string;
	entries: ToolEntry[];
	group: string | undefined;
}

export function buildSlots(entries: readonly ToolEntry[]): ToolbarSlot[] {
	const slots: MutableSlot[] = [];
	for (const entry of entries) {
		const group = entry.tool.toolbarGroup;
		if (group === undefined) {
			slots.push({ id: `tool:${entry.id}`, entries: [entry], group });
			continue;
		}
		const existing = slots.find((slot) => slot.group === group);
		if (existing) existing.entries.push(entry);
		else slots.push({ id: group, entries: [entry], group });
	}
	return slots;
}

/** The member a slot's main button shows: the active one, else the last used, else the first. */
export function shownEntry(
	slot: ToolbarSlot,
	activeId: string,
	lastUsedId: string | undefined
): ToolEntry {
	const active = slot.entries.find((entry) => entry.id === activeId);
	if (active) return active;
	const lastUsed = slot.entries.find((entry) => entry.id === lastUsedId);
	if (lastUsed) return lastUsed;
	return slot.entries[0];
}

export function groupMenuPath(group: string): string {
	return `toolbar/group/${group}`;
}
