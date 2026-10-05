// Inserts HTML into the open document as one transaction: measure, convert, apply. Top-level
// designs go beside everything on the current page so they never cover existing work.

import type { DocumentService } from '../../services/document';
import {
	keyBetween,
	planInsertAll,
	type ChangeOrigin,
	type NodeId,
	type Rect
} from '../../document';
import { FALLBACK_FAMILY } from '../../fonts/bundled';
import type { FontRef } from '../../fonts/resolve';
import { isItalic, weightOf } from '../../text/fontFace';
import { placeBeside } from '../generate';
import { htmlToNodes, type FontSource } from './index';

/** What insertion needs from the fonts service: which faces exist and their bytes. */
export interface FontLibrary {
	families(): string[];
	faces(): FontRef[];
	load(ref: FontRef): Promise<{ bytes: ArrayBuffer }>;
}

export interface InsertHtmlServices {
	document: DocumentService;
	fonts?: FontLibrary;
}

export interface InsertHtmlOptions {
	/** Defaults to the current page. */
	parentId?: NodeId;
	/** Where the first root goes in the parent; defaults to beside the page's content. */
	origin?: { x: number; y: number };
	viewportWidth?: number;
	label?: string;
	changeOrigin?: ChangeOrigin;
	runId?: string;
	variables?: Readonly<Record<string, string>>;
	cssVariables?: Readonly<Record<string, string>>;
}

export interface InsertHtmlResult {
	rootIds: NodeId[];
	created: number;
	idsByDataId: Record<string, NodeId>;
	warnings: string[];
}

const DEFAULT_VIEWPORT_WIDTH = 1440;
const DEFAULT_VIEWPORT_HEIGHT = 900;

export function fontSourceOf(fonts: FontLibrary): FontSource {
	return {
		families: () => fonts.families(),
		faces: async (family) => {
			const entries = fonts.faces().filter((face) => face.family === family);
			return Promise.all(
				entries.map(async (entry) => ({
					weight: weightOf(entry.style),
					italic: isItalic(entry.style),
					bytes: (await fonts.load(entry)).bytes
				}))
			);
		}
	};
}

function besidePageContent(document: DocumentService): { x: number; y: number } {
	const bounds: Rect[] = document
		.children(document.currentPageId)
		.map((id) => document.absoluteBounds(id));
	return placeBeside(bounds);
}

export async function insertHtml(
	services: InsertHtmlServices,
	html: string,
	options: InsertHtmlOptions = {}
): Promise<InsertHtmlResult> {
	const document = services.document;
	const parentId = options.parentId ?? document.currentPageId;
	let origin = options.origin;
	if (origin === undefined) {
		origin = { x: 0, y: 0 };
		if (parentId === document.currentPageId) origin = besidePageContent(document);
	}
	let fonts: FontSource | undefined;
	if (services.fonts !== undefined) fonts = fontSourceOf(services.fonts);
	const result = await htmlToNodes(
		html,
		{
			viewportWidth: options.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH,
			viewportHeight: DEFAULT_VIEWPORT_HEIGHT,
			defaultFamily: FALLBACK_FAMILY,
			monospaceFamily: 'Geist Mono',
			fonts,
			cssVariables: options.cssVariables
		},
		{ parentId, origin, variables: options.variables, availableFamilies: undefined }
	);
	const siblings = document.children(parentId);
	let lower: string | null = null;
	const last = siblings[siblings.length - 1];
	if (last !== undefined) lower = document.reader.requireNode(last).index;
	const nodes = result.nodes.map((node) => {
		if (!result.rootIds.includes(node.id)) return node;
		const index = keyBetween(lower, null);
		lower = index;
		return { ...node, index };
	});
	if (nodes.length > 0) {
		document.apply(planInsertAll(nodes), {
			origin: options.changeOrigin ?? 'ai',
			label: options.label ?? 'Insert HTML',
			runId: options.runId
		});
	}
	return {
		rootIds: result.rootIds,
		created: nodes.length,
		idsByDataId: result.idsByDataId,
		warnings: result.warnings
	};
}
