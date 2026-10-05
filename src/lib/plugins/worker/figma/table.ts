// What the Figma compatibility layer supports and what it refuses. Every Figma API member a plugin
// is likely to touch is in one of two lists; the unsupported ones throw a `FigmaCompatError` that
// names the member and says why, instead of being silently `undefined` (so a plugin fails where it
// uses something that would give wrong results). Names in neither list read as `undefined`, which
// keeps feature detection (`if (figma.foo)`) working. docs/plugins/figma-compat.md prints these
// tables; a test keeps the two in step.

export class FigmaCompatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FigmaCompatError';
	}
}

export function unsupportedMessage(member: string, reason: string): string {
	return `${member} is not supported by the Figma compatibility layer: ${reason} (see docs/plugins/figma-compat.md)`;
}

export const SUPPORTED_FIGMA_MEMBERS = [
	'apiVersion',
	'command',
	'editorType',
	'mixed',
	'root',
	'currentPage',
	'viewport.zoom',
	'viewport.scrollAndZoomIntoView',
	'createRectangle',
	'createEllipse',
	'createText',
	'createFrame',
	'createLine',
	'createPolygon',
	'createStar',
	'createComponent',
	'createSection',
	'group',
	'ungroup',
	'getNodeById',
	'getNodeByIdAsync',
	'loadFontAsync',
	'notify',
	'showUI (surface tree)',
	'closePlugin',
	'on / once / off (selectionchange, close)',
	'clientStorage',
	'commitUndo'
] as const;

export const SUPPORTED_NODE_MEMBERS = [
	'id',
	'type',
	'name',
	'parent',
	'removed',
	'visible',
	'locked',
	'opacity',
	'x',
	'y',
	'width',
	'height',
	'rotation',
	'resize',
	'resizeWithoutConstraints',
	'fills (SOLID)',
	'strokes (SOLID, one)',
	'strokeWeight',
	'cornerRadius',
	'clipsContent',
	'layoutMode / itemSpacing / padding* / alignment / sizing',
	'characters (TEXT)',
	'fontSize (TEXT)',
	'fontName (TEXT)',
	'children / appendChild / insertChild',
	'findAll / findOne / findChildren / findChild',
	'selection (page)',
	'remove',
	'clone',
	'getPluginData / setPluginData / getPluginDataKeys',
	'getSharedPluginData / setSharedPluginData / getSharedPluginDataKeys',
	'setRelaunchData / getRelaunchData'
] as const;

export const UNSUPPORTED_FIGMA_MEMBERS: Record<string, string> = {
	fileKey: 'documents have no file key',
	currentUser: 'there are no accounts',
	activeUsers: 'there are no accounts',
	pluginId: 'use design.pluginId',
	createPage: 'the plugin API cannot create pages yet',
	createImage: 'images cannot be created from plugins yet',
	createImageAsync: 'images cannot be created from plugins yet',
	createVector: 'vector networks cannot be built from plugins yet',
	createBooleanOperation: 'boolean operations cannot be built from plugins yet',
	createComponentFromNode: 'use createComponent',
	createPaintStyle: 'styles cannot be created from plugins yet',
	createTextStyle: 'styles cannot be created from plugins yet',
	createEffectStyle: 'styles cannot be created from plugins yet',
	createGridStyle: 'styles cannot be created from plugins yet',
	flatten: 'not available to plugins yet',
	union: 'not available to plugins yet',
	subtract: 'not available to plugins yet',
	intersect: 'not available to plugins yet',
	exclude: 'not available to plugins yet',
	getLocalPaintStyles: 'styles are not mirrored',
	getLocalTextStyles: 'styles are not mirrored',
	getStyleById: 'styles are not mirrored',
	listAvailableFontsAsync: 'fonts are managed by the app',
	getFileThumbnailNodeAsync: 'not available',
	saveVersionHistoryAsync: 'not available',
	triggerUndo: 'a plugin cannot undo; use design.commitUndo to split steps',
	skipInvisibleInstanceChildren: 'not needed',
	ui: 'plugin UI is a declarative surface, not an HTML iframe; use figma.showUI(tree)',
	parameters: 'parameter input is not available',
	payments: 'there is no payment system',
	timer: 'there is no timer',
	codegen: 'use design.codegen',
	variables: 'use design.document.variables()',
	teamLibrary: 'there are no team libraries',
	util: 'not available',
	base64Encode: 'use btoa',
	base64Decode: 'use atob',
	'viewport.center': 'the camera is described by x, y and zoom; use design.viewport',
	'viewport.bounds': 'the camera is described by x, y and zoom; use design.viewport'
};

export const UNSUPPORTED_NODE_MEMBERS: Record<string, string> = {
	effects: 'effects cannot be edited from plugins yet',
	exportAsync: 'use the export commands',
	exportSettings: 'use the export commands',
	constraints: 'constraints cannot be edited from plugins yet',
	reactions: 'prototype interactions cannot be edited from plugins yet',
	absoluteTransform: 'derived geometry is not mirrored',
	absoluteBoundingBox: 'derived geometry is not mirrored',
	absoluteRenderBounds: 'derived geometry is not mirrored',
	relativeTransform: 'use x, y and rotation',
	vectorNetwork: 'vector networks cannot be edited from plugins yet',
	vectorPaths: 'vector networks cannot be edited from plugins yet',
	booleanOperation: 'boolean operations cannot be edited from plugins yet',
	mainComponent: 'component instances cannot be edited from plugins yet',
	createInstance: 'component instances cannot be created from plugins yet',
	swapComponent: 'component instances cannot be edited from plugins yet',
	detachInstance: 'component instances cannot be edited from plugins yet',
	setTextStyleIdAsync: 'styles cannot be applied from plugins yet',
	setFillStyleIdAsync: 'styles cannot be applied from plugins yet',
	fillStyleId: 'styles cannot be applied from plugins yet',
	textStyleId: 'styles cannot be applied from plugins yet',
	setRangeFontName: 'styled text ranges cannot be edited from plugins yet',
	setRangeFontSize: 'styled text ranges cannot be edited from plugins yet',
	setRangeFills: 'styled text ranges cannot be edited from plugins yet',
	getRangeFontName: 'styled text ranges are not mirrored',
	getStyledTextSegments: 'styled text ranges are not mirrored',
	textAutoResize: 'text sizing cannot be edited from plugins yet',
	textAlignHorizontal: 'text alignment cannot be edited from plugins yet',
	lineHeight: 'text metrics cannot be edited from plugins yet',
	letterSpacing: 'text metrics cannot be edited from plugins yet',
	fontWeight: 'use fontName',
	insertFrom: 'not available',
	findAllWithCriteria: 'use findAll with a callback',
	findWidgetNodesByWidgetId: 'widgets do not exist',
	clearPluginData: 'set the key to an empty string instead',
	setPluginDataAsync: 'use setPluginData',
	getPluginDataAsync: 'use getPluginData',
	isMask: 'masks cannot be edited from plugins yet',
	maskType: 'masks cannot be edited from plugins yet',
	rescale: 'scaling cannot be done from plugins yet'
};

/** Scopes of the table, for the docs test. */
export const COMPAT_TABLE = {
	supportedFigma: SUPPORTED_FIGMA_MEMBERS,
	supportedNode: SUPPORTED_NODE_MEMBERS,
	unsupportedFigma: UNSUPPORTED_FIGMA_MEMBERS,
	unsupportedNode: UNSUPPORTED_NODE_MEMBERS
};
