// HTML to document nodes: the browser lays the HTML out (layout.ts), the snapshot of what it
// computed becomes nodes (convert.ts). The model writes HTML and CSS, which it knows well; the
// document keeps its own model.

import { convertSnapshot, type ConvertOptions, type ConvertResult } from './convert';
import { measureHtml, type LayoutOptions } from './layout';

export type { ConvertOptions, ConvertResult } from './convert';
export type { FontFaceSource, FontSource, LayoutOptions } from './layout';
export type { HtmlSnapshot } from './snapshot';
export { convertSnapshot } from './convert';
export { measureHtml } from './layout';

export async function htmlToNodes(
	html: string,
	layout: LayoutOptions,
	convert: ConvertOptions
): Promise<ConvertResult> {
	const snapshot = await measureHtml(html, layout);
	return convertSnapshot(snapshot, convert);
}
