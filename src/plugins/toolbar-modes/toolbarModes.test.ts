import { expect } from 'vitest';
import { describePlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import corePanels from '../core-panels';
import coreRegions from '../core-regions';
import coreTools from '../core-tools';
import toolbar from '../toolbar';
import toolbarModes from './index';

describePlugin('toolbar-modes', toolbarModes, {
	providers: [
		coreRegions,
		coreContextKeys,
		coreCommands,
		coreKeymap,
		coreMenus,
		coreTools,
		corePanels,
		toolbar
	],
	contributes: async ({ ctx }) => {
		expect(ctx.toolbar.modes().map((mode) => mode.id)).toEqual(['design', 'dev']);
		expect(ctx.toolbar.currentModeId()).toBe('design');
		await ctx.toolbar.switchMode(ctx.toolbar.modes()[1]);
		expect(ctx.toolbar.currentModeId()).toBe('dev');
		await ctx.toolbar.switchMode(ctx.toolbar.modes()[0]);
	}
});
