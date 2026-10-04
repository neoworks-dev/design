// The single manifest of built-in plugins. Order is stable but must not matter for correctness:
// plugins declare `inject` and activate when their providers appear.

import type { Plugin } from '@neoworks/extension-system';
import coreCommands from './core-commands';
import coreContextKeys from './core-context-keys';
import coreKeymap from './core-keymap';
import coreRegions from './core-regions';
import desktopBridge from './desktop-bridge';
import documentPlugin from './document';
import selection from './selection';
import placeholderShell from './placeholder-shell';
import titlebar from './titlebar';
import workbenchLayout from './workbench-layout';

export const builtinPlugins: Plugin[] = [
	coreRegions,
	desktopBridge,
	documentPlugin,
	selection,
	coreContextKeys,
	coreCommands,
	coreKeymap,
	workbenchLayout,
	titlebar,
	placeholderShell
];
