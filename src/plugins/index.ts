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
import fonts from './fonts';
import documentPlugin from './document';
import selection from './selection';
import fileSession from './file-session';
import history from './history';
import recentFiles from './recent-files';
import placeholderShell from './placeholder-shell';
import titlebar from './titlebar';
import variablesCore from './variables-core';
import workbenchLayout from './workbench-layout';

export const builtinPlugins: Plugin[] = [
	coreRegions,
	debug,
	desktopBridge,
	fonts,
	documentPlugin,
	selection,
	history,
	fileSession,
	recentFiles,
	variablesCore,
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
