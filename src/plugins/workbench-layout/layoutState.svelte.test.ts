import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SIDEBAR_WIDTH,
	LAYOUT_STORAGE_KEY,
	LayoutState,
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	persistLayout
} from './layoutState.svelte';
import { memoryStorage } from './testStorage';

describe('LayoutState', () => {
	it('starts with default widths and nothing collapsed', () => {
		const state = new LayoutState();
		expect(state.leftWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
		expect(state.rightWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
		expect(state.leftCollapsed).toBe(false);
		expect(state.uiHidden).toBe(false);
	});

	it('clamps widths and resets to the default', () => {
		const state = new LayoutState();
		state.setWidth('left', 5000);
		expect(state.leftWidth).toBe(MAX_SIDEBAR_WIDTH);
		state.setWidth('left', 10);
		expect(state.leftWidth).toBe(MIN_SIDEBAR_WIDTH);
		state.resetWidth('left');
		expect(state.leftWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
	});

	it('toggles sidebars and the whole UI independently', () => {
		const state = new LayoutState();
		state.toggleSidebar('right');
		expect(state.isCollapsed('right')).toBe(true);
		expect(state.isCollapsed('left')).toBe(false);
		state.toggleUi();
		expect(state.uiHidden).toBe(true);
	});

	it('restores widths and collapsed sidebars from storage, ignoring junk', () => {
		const saved = memoryStorage({
			[LAYOUT_STORAGE_KEY]: JSON.stringify({
				leftWidth: 300,
				rightWidth: 'wide',
				leftCollapsed: true,
				rightCollapsed: 1
			})
		});
		const state = new LayoutState(saved);
		expect(state.leftWidth).toBe(300);
		expect(state.rightWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
		expect(state.leftCollapsed).toBe(true);
		expect(state.rightCollapsed).toBe(false);

		const broken = new LayoutState(memoryStorage({ [LAYOUT_STORAGE_KEY]: '{nope' }));
		expect(broken.leftWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
	});

	it('persists changes and a new state restores them (simulated restart)', () => {
		const storage = memoryStorage();
		const state = new LayoutState(storage);
		const stop = persistLayout(state, storage);
		flushSync();
		state.setWidth('left', 320);
		state.toggleSidebar('right');
		flushSync();
		stop();

		const restarted = new LayoutState(storage);
		expect(restarted.leftWidth).toBe(320);
		expect(restarted.rightCollapsed).toBe(true);
	});

	it('does not persist the hidden-UI toggle', () => {
		const storage = memoryStorage();
		const state = new LayoutState(storage);
		const stop = persistLayout(state, storage);
		state.toggleUi();
		flushSync();
		stop();
		expect(new LayoutState(storage).uiHidden).toBe(false);
	});

	it('stops writing after the persist effect is disposed', () => {
		const storage = memoryStorage();
		const state = new LayoutState(storage);
		const stop = persistLayout(state, storage);
		flushSync();
		stop();
		state.setWidth('left', 400);
		flushSync();
		expect(new LayoutState(storage).leftWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
	});
});
