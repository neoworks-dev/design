// The single manifest of built-in plugins. Order is stable but must not matter for correctness:
// plugins declare `inject` and activate when their providers appear.

import type { Plugin } from '@neoworks/extension-system';
import coreCommands from './core-commands';
import coreContextKeys from './core-context-keys';
import coreKeymap from './core-keymap';
import coreMenus from './core-menus';
import coreInspectors from './core-inspectors';
import corePanels from './core-panels';
import coreRegions from './core-regions';
import coreTools from './core-tools';
import debug from './debug';
import desktopBridge from './desktop-bridge';
import placeholderShell from './placeholder-shell';
import titlebar from './titlebar';
import workbenchLayout from './workbench-layout';

export const builtinPlugins: Plugin[] = [
	coreRegions,
	debug,
	desktopBridge,
	coreContextKeys,
	coreCommands,
	coreKeymap,
	coreMenus,
	corePanels,
	coreInspectors,
	coreTools,
	workbenchLayout,
	titlebar,
	placeholderShell
];
