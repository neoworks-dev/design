// The single manifest of built-in plugins. Order is stable but must not matter for correctness:
// plugins declare `inject` and activate when their providers appear.

import type { Plugin } from '@neoworks/extension-system';
import assetsStore from './assets-store';
import canvasInput from './canvas-input';
import canvaskit from './canvaskit';
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
import spatial from './spatial';
import hitTest from './hit-test';
import snapping from './snapping';
import fileSession from './file-session';
import history from './history';
import recentFiles from './recent-files';
import placeholderShell from './placeholder-shell';
import renderer from './renderer';
import sceneFixture from './scene-fixture';
import titlebar from './titlebar';
import variablesCore from './variables-core';
import viewport from './viewport';
import viewTools from './view-tools';
import toolMove from './tool-move';
import toolShapes from './tool-shapes';
import toolFrame from './tool-frame';
import workbenchLayout from './workbench-layout';
import grouping from './grouping';
import nodeCommands from './node-commands';
import nudge from './nudge';
import selectionCommands from './selection-commands';
import zOrder from './z-order';

export const builtinPlugins: Plugin[] = [
	coreRegions,
	canvaskit,
	renderer,
	sceneFixture,
	viewport,
	debug,
	desktopBridge,
	fonts,
	assetsStore,
	documentPlugin,
	selection,
	spatial,
	hitTest,
	snapping,
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
	canvasInput,
	viewTools,
	toolMove,
	toolShapes,
	toolFrame,
	workbenchLayout,
	titlebar,
	placeholderShell,
	nudge,
	selectionCommands,
	zOrder,
	grouping,
	nodeCommands
];
