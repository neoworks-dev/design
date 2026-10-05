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
import boolean from './boolean';
import clipboard from './clipboard';
import colorPicker from './color-picker';
import contextMenus from './context-menus';
import designPanel from './design-panel';
import duplicate from './duplicate';
import inspectorAppearance from './inspector-appearance';
import inspectorEffects from './inspector-effects';
import inspectorFill from './inspector-fill';
import inspectorLayoutSize from './inspector-layout-size';
import inspectorStroke from './inspector-stroke';
import inspectorPosition from './inspector-position';
import selection from './selection';
import spatial from './spatial';
import hitTest from './hit-test';
import snapping from './snapping';
import fileSession from './file-session';
import flatten from './flatten';
import history from './history';
import imageCache from './image-cache';
import recentFiles from './recent-files';
import overlay from './overlay';
import paintShaders from './paint-shaders';
import pixelGrid from './pixel-grid';
import placeholderShell from './placeholder-shell';
import renderer from './renderer';
import rulersGuides from './rulers-guides';
import sceneFixture from './scene-fixture';
import svgImport from './svg-import';
import textEdit from './text-edit';
import textFormat from './text-format';
import textLayout from './text-layout';
import toolText from './tool-text';
import titlebar from './titlebar';
import variablesCore from './variables-core';
import viewport from './viewport';
import viewTools from './view-tools';
import zoomMenu from './zoom-menu';
import toolbar from './toolbar';
import toolMove from './tool-move';
import toolImage from './tool-image';
import toolScale from './tool-scale';
import toolSection from './tool-section';
import toolSlice from './tool-slice';
import toolShapes from './tool-shapes';
import toolFrame from './tool-frame';
import toolPen from './tool-pen';
import toolPencil from './tool-pencil';
import vectorEdit from './vector-edit';
import workbenchLayout from './workbench-layout';
import gradientEditor from './gradient-editor';
import grouping from './grouping';
import layersPanel from './layers-panel';
import mask from './mask';
import pagesPanel from './pages-panel';
import nodeCommands from './node-commands';
import nudge from './nudge';
import selectionCommands from './selection-commands';
import shortcuts from './shortcuts';
import shapeHandles from './shape-handles';
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
	rulersGuides,
	flatten,
	svgImport,
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
	shortcuts,
	coreMenus,
	corePanels,
	coreInspectors,
	designPanel,
	inspectorPosition,
	inspectorLayoutSize,
	inspectorAppearance,
	colorPicker,
	gradientEditor,
	inspectorFill,
	inspectorStroke,
	inspectorEffects,
	coreTools,
	toolbar,
	canvasInput,
	viewTools,
	zoomMenu,
	toolMove,
	transformHandles,
	shapeHandles,
	toolImage,
	toolScale,
	toolSection,
	toolSlice,
	toolShapes,
	toolFrame,
	toolText,
	toolPen,
	toolPencil,
	vectorEdit,
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
	boolean,
	clipboard,
	contextMenus,
	layersPanel,
	pagesPanel
];
