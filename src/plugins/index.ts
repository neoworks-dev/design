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
import effects from './effects';
import fonts from './fonts';
import headlessRenderer from './headless-renderer';
import documentPlugin from './document';
import documentScene from './document-scene';
import align from './align';
import clipboard from './clipboard';
import duplicate from './duplicate';
import selection from './selection';
import spatial from './spatial';
import hitTest from './hit-test';
import snapping from './snapping';
import fileSession from './file-session';
import history from './history';
import imageCache from './image-cache';
import recentFiles from './recent-files';
import overlay from './overlay';
import paintShaders from './paint-shaders';
import pixelGrid from './pixel-grid';
import placeholderShell from './placeholder-shell';
import renderer from './renderer';
import sceneFixture from './scene-fixture';
import textEdit from './text-edit';
import textFormat from './text-format';
import textLayout from './text-layout';
import toolText from './tool-text';
import titlebar from './titlebar';
import variablesCore from './variables-core';
import viewport from './viewport';
import viewTools from './view-tools';
import toolMove from './tool-move';
import toolShapes from './tool-shapes';
import toolFrame from './tool-frame';
import workbenchLayout from './workbench-layout';
import grouping from './grouping';
import mask from './mask';
import nodeCommands from './node-commands';
import nudge from './nudge';
import selectionCommands from './selection-commands';
import transformHandles from './transform-handles';
import zOrder from './z-order';

export const builtinPlugins: Plugin[] = [
	coreRegions,
	canvaskit,
	renderer,
	sceneFixture,
	viewport,
	overlay,
	pixelGrid,
	debug,
	desktopBridge,
	fonts,
	assetsStore,
	imageCache,
	paintShaders,
	effects,
	textLayout,
	textEdit,
	textFormat,
	documentPlugin,
	documentScene,
	selection,
	spatial,
	headlessRenderer,
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
	transformHandles,
	toolShapes,
	toolFrame,
	toolText,
	workbenchLayout,
	titlebar,
	placeholderShell,
	nudge,
	selectionCommands,
	zOrder,
	grouping,
	mask,
	nodeCommands,
	duplicate,
	align,
	clipboard
];
