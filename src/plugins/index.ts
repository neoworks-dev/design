// The single manifest of built-in plugins. Order is stable but must not matter for correctness:
// plugins declare `inject` and activate when their providers appear.

import type { Plugin } from '@neoworks/extension-system';
import archiveIo from './archive-io';
import assetsStore from './assets-store';
import canvasInput from './canvas-input';
import canvaskit from './canvaskit';
import componentSync from './component-sync';
import componentProperties from './component-properties';
import components from './components';
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
import errorUi from './error-ui';
import fonts from './fonts';
import htmlLayout from './html-layout';
import exportPlugin from './export';
import exportPdf from './export-pdf';
import exportUi from './export-ui';
import exportRaster from './export-raster';
import exportSvg from './export-svg';
import headlessRenderer from './headless-renderer';
import documentPlugin from './document';
import documentScene from './document-scene';
import ai from './ai';
import aiBatch from './ai-batch';
import aiChat from './ai-chat';
import aiSelectionPrompt from './ai-selection-prompt';
import aiContext from './ai-context';
import aiGenerate from './ai-generate';
import aiHistory from './ai-history';
import aiPalette from './ai-palette';
import aiRename from './ai-rename';
import aiSearch from './ai-search';
import aiReview from './ai-review';
import aiTools from './ai-tools';
import align from './align';
import autolayout from './autolayout';
import autolayoutHandles from './autolayout-handles';
import appMenu from './app-menu';
import boolean from './boolean';
import clipboard from './clipboard';
import colorPicker from './color-picker';
import comments from './comments';
import constraints from './constraints';
import contextMenus from './context-menus';
import designPanel from './design-panel';
import duplicate from './duplicate';
import inspectorAppearance from './inspector-appearance';
import layoutGrids from './layout-grids';
import inspectPanel from './inspect-panel';
import inspectorEffects from './inspector-effects';
import inspectorFill from './inspector-fill';
import inspectorLayoutSize from './inspector-layout-size';
import inspectorStroke from './inspector-stroke';
import inspectorPage from './inspector-page';
import inspectorPosition from './inspector-position';
import inspectorSelectionColors from './inspector-selection-colors';
import inspectorTypography from './inspector-typography';
import selection from './selection';
import shortcutsPanel from './shortcuts-panel';
import shortcutsStore from './shortcuts-store';
import spatial from './spatial';
import hitTest from './hit-test';
import snapping from './snapping';
import fileSession from './file-session';
import fileThumbnails from './file-thumbnails';
import home from './home';
import flatten from './flatten';
import history from './history';
import imageCache from './image-cache';
import recentFiles from './recent-files';
import commandPalette from './command-palette';
import paletteSources from './palette-sources';
import overlay from './overlay';
import paintShaders from './paint-shaders';
import pixelGrid from './pixel-grid';
import pluginApi from './plugin-api';
import pluginDevtools from './plugin-devtools';
import pluginFigmaCompat from './plugin-figma-compat';
import pluginHost from './plugin-host';
import pluginManager from './plugin-manager';
import pluginManifests from './plugin-manifests';
import pluginPermissions from './plugin-permissions';
import pluginStorage from './plugin-storage';
import pluginUi from './plugin-ui';
import placeholderShell from './placeholder-shell';
import assetsPanel from './assets-panel';
import resourcesSearch from './resources-search';
import renderer from './renderer';
import rulersGuides from './rulers-guides';
import sceneFixture from './scene-fixture';
import settings from './settings';
import svgImport from './svg-import';
import tabs from './tabs';
import textEdit from './text-edit';
import textFormat from './text-format';
import textLayout from './text-layout';
import toolText from './tool-text';
import titlebar from './titlebar';
import variablesCore from './variables-core';
import variablesUi from './variables-ui';
import styles from './styles';
import variants from './variants';
import versionHistory from './version-history';
import viewport from './viewport';
import viewTools from './view-tools';
import zoomMenu from './zoom-menu';
import toolbar from './toolbar';
import toolbarModes from './toolbar-modes';
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
import prototypePanel from './prototype-panel';
import prototypeConnections from './prototype-connections';
import prototypeRuntime from './prototype-runtime';
import presentation from './presentation';
import nodeCommands from './node-commands';
import nudge from './nudge';
import selectionCommands from './selection-commands';
import shortcuts from './shortcuts';
import shapeHandles from './shape-handles';
import transformHandles from './transform-handles';
import zOrder from './z-order';

/**
 * Plugins safe mode leaves out: everything that is not needed to open, look at and edit a
 * document. The shell, document, canvas, selection, history and file session stay.
 */
export const optionalPluginNames: ReadonlySet<string> = new Set([
	'ai',
	'ai-batch',
	'ai-chat',
	'ai-context',
	'ai-generate',
	'ai-history',
	'ai-palette',
	'ai-rename',
	'ai-review',
	'ai-search',
	'ai-selection-prompt',
	'ai-tools',
	'comments',
	'export',
	'export-pdf',
	'export-raster',
	'export-svg',
	'export-ui',
	'html-layout',
	'scene-fixture',
	'svg-import'
]);

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
	settings,
	fonts,
	assetsStore,
	imageCache,
	paintShaders,
	effects,
	textLayout,
	autolayout,
	constraints,
	textEdit,
	textFormat,
	documentPlugin,
	componentSync,
	components,
	variants,
	componentProperties,
	documentScene,
	selection,
	spatial,
	comments,
	headlessRenderer,
	hitTest,
	snapping,
	history,
	fileSession,
	recentFiles,
	fileThumbnails,
	home,
	tabs,
	variablesCore,
	variablesUi,
	styles,
	coreContextKeys,
	coreCommands,
	coreKeymap,
	shortcuts,
	shortcutsPanel,
	shortcutsStore,
	coreMenus,
	commandPalette,
	appMenu,
	paletteSources,
	corePanels,
	coreInspectors,
	designPanel,
	prototypePanel,
	prototypeConnections,
	prototypeRuntime,
	presentation,
	inspectorPage,
	inspectorPosition,
	inspectorLayoutSize,
	inspectorAppearance,
	inspectorTypography,
	inspectorSelectionColors,
	layoutGrids,
	inspectPanel,
	colorPicker,
	gradientEditor,
	inspectorFill,
	inspectorStroke,
	inspectorEffects,
	coreTools,
	toolbar,
	toolbarModes,
	canvasInput,
	viewTools,
	zoomMenu,
	toolMove,
	transformHandles,
	autolayoutHandles,
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
	assetsPanel,
	resourcesSearch,
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
	pagesPanel,
	ai,
	htmlLayout,
	aiTools,
	aiHistory,
	aiContext,
	aiReview,
	aiRename,
	aiSearch,
	aiGenerate,
	aiPalette,
	aiBatch,
	aiChat,
	aiSelectionPrompt,
	exportPlugin,
	exportRaster,
	exportSvg,
	exportPdf,
	exportUi,
	pluginManifests,
	pluginHost,
	pluginApi,
	pluginPermissions,
	pluginStorage,
	pluginFigmaCompat,
	pluginManager,
	pluginDevtools,
	pluginUi,
	errorUi,
	versionHistory,
	archiveIo
];
