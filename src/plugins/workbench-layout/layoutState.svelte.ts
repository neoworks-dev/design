// Reactive state of the workbench chrome: sidebar widths, collapsed sidebars and the hidden-UI
// toggle. A plain class (not a Service) so it may hold runes; the service exposes it as a field.

import { untrack } from 'svelte';
import type { ContextKeysService } from '../../lib/registries/contextKeys.svelte';

export type SidebarSide = 'left' | 'right';

export interface LayoutStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const DEFAULT_SIDEBAR_WIDTH = 240;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;
export const LAYOUT_STORAGE_KEY = 'workbench-layout/state';

interface PersistedLayout {
	leftWidth: number;
	rightWidth: number;
	leftCollapsed: boolean;
	rightCollapsed: boolean;
}

function clampWidth(width: number): number {
	return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function readNumber(value: unknown, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return clampWidth(value);
}

function readBoolean(value: unknown): boolean {
	return value === true;
}

function parsePersisted(raw: string | null): Partial<Record<keyof PersistedLayout, unknown>> {
	if (raw === null) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return {};
		return parsed;
	} catch {
		return {};
	}
}

export class LayoutState {
	leftWidth = $state(DEFAULT_SIDEBAR_WIDTH);
	rightWidth = $state(DEFAULT_SIDEBAR_WIDTH);
	leftCollapsed = $state(false);
	rightCollapsed = $state(false);
	/** Ctrl+\ hides all chrome. Not persisted: a hidden UI after restart would look like a bug. */
	uiHidden = $state(false);

	constructor(storage?: LayoutStorage) {
		if (!storage) return;
		const saved = parsePersisted(storage.getItem(LAYOUT_STORAGE_KEY));
		this.leftWidth = readNumber(saved.leftWidth, DEFAULT_SIDEBAR_WIDTH);
		this.rightWidth = readNumber(saved.rightWidth, DEFAULT_SIDEBAR_WIDTH);
		this.leftCollapsed = readBoolean(saved.leftCollapsed);
		this.rightCollapsed = readBoolean(saved.rightCollapsed);
	}

	width(side: SidebarSide): number {
		if (side === 'left') return this.leftWidth;
		return this.rightWidth;
	}

	isCollapsed(side: SidebarSide): boolean {
		if (side === 'left') return this.leftCollapsed;
		return this.rightCollapsed;
	}

	setWidth(side: SidebarSide, width: number): void {
		const clamped = clampWidth(width);
		if (side === 'left') this.leftWidth = clamped;
		else this.rightWidth = clamped;
	}

	resetWidth(side: SidebarSide): void {
		this.setWidth(side, DEFAULT_SIDEBAR_WIDTH);
	}

	toggleSidebar(side: SidebarSide): void {
		if (side === 'left') this.leftCollapsed = !this.leftCollapsed;
		else this.rightCollapsed = !this.rightCollapsed;
	}

	expandSidebar(side: SidebarSide): void {
		if (side === 'left') this.leftCollapsed = false;
		else this.rightCollapsed = false;
	}

	toggleUi(): void {
		this.uiHidden = !this.uiHidden;
	}

	serialize(): string {
		const persisted: PersistedLayout = {
			leftWidth: this.leftWidth,
			rightWidth: this.rightWidth,
			leftCollapsed: this.leftCollapsed,
			rightCollapsed: this.rightCollapsed
		};
		return JSON.stringify(persisted);
	}
}

/**
 * Write the layout to `storage` whenever it changes. Returns the stop function; meant to run
 * inside `ctx.effect` so that unloading the plugin stops the writes.
 */
export function persistLayout(state: LayoutState, storage: LayoutStorage): () => void {
	return $effect.root(() => {
		$effect(() => {
			storage.setItem(LAYOUT_STORAGE_KEY, state.serialize());
		});
	});
}

/**
 * Publish `sidebar.left.collapsed` / `sidebar.right.collapsed` so plugins (the sidebar rail) can
 * show the panel state without depending on this plugin. Returns the stop function.
 */
export function publishCollapsedKeys(
	state: LayoutState,
	contextKeys: ContextKeysService
): () => void {
	const disposers: Partial<Record<SidebarSide, () => void>> = {};
	const sides: SidebarSide[] = ['left', 'right'];
	const stop = $effect.root(() => {
		for (const side of sides) {
			$effect(() => {
				const collapsed = state.isCollapsed(side);
				const dispose = untrack(() => contextKeys.set(`sidebar.${side}.collapsed`, collapsed));
				disposers[side] = dispose;
				return dispose;
			});
		}
	});
	return () => {
		stop();
		for (const side of sides) disposers[side]?.();
	};
}
