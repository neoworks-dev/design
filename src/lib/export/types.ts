// Shared types of the export pipeline (#125): format providers, jobs and produced files.

import type { ExportSetting, NodeId, Rect, RGBA } from '../document/types';

export type ExportFormatName = ExportSetting['format'];

/** Choices of one run that are not part of a node's stored settings (they belong to the dialog). */
export interface ExportRunOptions {
	/** Only the node and its subtree (default true). */
	contentsOnly?: boolean;
	/** The node's own box instead of its render bounds (default false). */
	useAbsoluteBounds?: boolean;
	/** 0-100, JPG and WEBP. */
	quality?: number;
	/** Drawn behind the artwork. */
	background?: RGBA;
}

/** What a format provider is asked to render. */
export interface ExportRenderRequest {
	nodeId: NodeId;
	/** Pixels (or points, for vector formats) per document unit. */
	scale: number;
	/** The exported area in page space; its size times `scale` is the output size. */
	area: Rect;
	options: ExportRunOptions;
}

export interface RenderedExport {
	bytes: Uint8Array;
	width: number;
	height: number;
}

/** A file format the export service can produce; registered by a format plugin. */
export interface ExportFormatProvider {
	/** The format name, as stored in `ExportSetting.format`. */
	id: ExportFormatName;
	label: string;
	extension: string;
	mimeType: string;
	render(request: ExportRenderRequest): Promise<RenderedExport>;
}

/** One planned file: which node, with which setting, under which name. */
export interface ExportJob {
	nodeId: NodeId;
	setting: ExportSetting;
	fileName: string;
}

export interface ExportFile {
	nodeId: NodeId;
	setting: ExportSetting;
	name: string;
	format: ExportFormatName;
	mimeType: string;
	bytes: Uint8Array;
	width: number;
	height: number;
}

export class ExportPipelineError extends Error {}
