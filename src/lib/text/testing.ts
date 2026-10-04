// Test helpers for text layout: a headless CanvasKit with the bundled Geist faces registered.

import { readFile } from 'node:fs/promises';
import type { CanvasKit } from 'canvaskit-wasm';
import { createNode } from '../document/defaults';
import type { Paragraph, TextNode, TextRun, TextStyle } from '../document/types';
import { emptyParagraph } from '../document/text';
import { woffToSfnt } from '../fonts/woff';
import type { FontEntry, FontRef, ResolvedFont } from '../fonts/resolve';
import { loadCanvasKit } from '../renderer/canvaskit';
import { nodeWasmLocator } from '../renderer/canvaskit.node';
import { SkiaTracker } from '../renderer/ownership';
import { TextLayoutEngine } from './layoutEngine';

const FILES: [string, string, string][] = [
	['Geist', 'Regular', 'geist-sans-latin-400-normal.woff'],
	['Geist', 'Medium', 'geist-sans-latin-500-normal.woff'],
	['Geist', 'SemiBold', 'geist-sans-latin-600-normal.woff'],
	['Geist', 'Bold', 'geist-sans-latin-700-normal.woff']
];

const FACES: FontEntry[] = FILES.map(([family, style]) => ({ family, style, source: 'bundled' }));

/** Every document font resolves to Geist: "Inter" and friends show up as missing. */
export function testResolver(ref: FontRef): ResolvedFont {
	const exact = FACES.find((face) => face.family === ref.family && face.style === ref.style);
	if (exact) return { face: exact, missing: false };
	const sameStyle = FACES.find((face) => face.style === ref.style);
	return { face: sameStyle ?? FACES[0], missing: true };
}

export interface TextTestKit {
	kit: CanvasKit;
	tracker: SkiaTracker;
	engine: TextLayoutEngine;
}

/** The bundled Geist faces with their sfnt bytes, as the fonts service would deliver them. */
export async function loadTestFaces(): Promise<{ face: FontEntry; bytes: ArrayBuffer }[]> {
	const faces: { face: FontEntry; bytes: ArrayBuffer }[] = [];
	for (const [index, [, , file]] of FILES.entries()) {
		const raw = await readFile(`node_modules/@fontsource/geist-sans/files/${file}`);
		const sfnt = await woffToSfnt(new Uint8Array(raw));
		const bytes = sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength);
		faces.push({ face: FACES[index], bytes: bytes as ArrayBuffer });
	}
	return faces;
}

export async function createTextTestKit(registerFaces = true): Promise<TextTestKit> {
	const kit = await loadCanvasKit(nodeWasmLocator());
	const tracker = new SkiaTracker();
	const engine = new TextLayoutEngine(kit, tracker, testResolver);
	if (!registerFaces) return { kit, tracker, engine };
	for (const { face, bytes } of await loadTestFaces()) engine.registerFont(face, bytes);
	return { kit, tracker, engine };
}

export function textNode(
	paragraphs: Paragraph[],
	props: Partial<TextNode> = {},
	defaultStyle: Partial<TextStyle> = {}
): TextNode {
	const base = createNode('TEXT', { id: 'text', width: 200, height: 40, ...props });
	if (base.type !== 'TEXT') throw new Error('not a text node');
	return {
		...base,
		...props,
		paragraphs,
		defaultStyle: {
			...base.defaultStyle,
			fontName: { family: 'Geist', style: 'Regular' },
			...defaultStyle
		}
	};
}

export function paragraphOf(
	text: string,
	style: Partial<TextStyle> = {},
	props: Partial<Paragraph> = {}
): Paragraph {
	const runs: TextRun[] = [];
	if (text !== '') runs.push({ text, style });
	return { ...emptyParagraph(), ...props, runs };
}
