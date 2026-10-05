// SVG files placed as images: the renderer draws bitmaps, so an SVG is rasterised once at its own
// size and stored like any other image (the vector import path is `lib/editing/svg.ts`).

const SNIFF_BYTES = 1024;
const DEFAULT_SIZE = 300;
const MAX_SIDE = 4096;

/** True when the bytes look like an SVG document (the first kilobyte mentions `<svg`). */
export function looksLikeSvg(bytes: Uint8Array): boolean {
	const head = new TextDecoder().decode(bytes.subarray(0, SNIFF_BYTES));
	return head.includes('<svg');
}

export interface SvgSize {
	width: number;
	height: number;
}

function numberAttribute(source: string, name: string): number | undefined {
	const match = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?\\s*["']`, 'i').exec(
		source
	);
	if (match === null) return undefined;
	const value = Number(match[1]);
	if (!Number.isFinite(value) || value <= 0) return undefined;
	return value;
}

/** Natural size from `width`/`height`, else the `viewBox`, else 300 x 300. */
export function svgSize(text: string): SvgSize {
	const tag = /<svg\b[^>]*>/i.exec(text);
	if (tag === null) return { width: DEFAULT_SIZE, height: DEFAULT_SIZE };
	const width = numberAttribute(tag[0], 'width');
	const height = numberAttribute(tag[0], 'height');
	if (width !== undefined && height !== undefined) return clampSize({ width, height });
	const viewBox =
		/viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(
			tag[0]
		);
	if (viewBox === null) return { width: DEFAULT_SIZE, height: DEFAULT_SIZE };
	return clampSize({ width: Number(viewBox[1]), height: Number(viewBox[2]) });
}

function clampSize(size: SvgSize): SvgSize {
	const scale = Math.min(1, MAX_SIDE / Math.max(size.width, size.height));
	return {
		width: Math.max(1, Math.round(size.width * scale)),
		height: Math.max(1, Math.round(size.height * scale))
	};
}

/** PNG bytes of the SVG at its natural size. Needs a browser (image decoding and a canvas). */
export async function rasterizeSvg(bytes: Uint8Array): Promise<Uint8Array> {
	const text = new TextDecoder().decode(bytes);
	const size = svgSize(text);
	const blob = new Blob([text], { type: 'image/svg+xml' });
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image(size.width, size.height);
		image.src = url;
		await image.decode();
		const canvas = new OffscreenCanvas(size.width, size.height);
		const context = canvas.getContext('2d');
		if (context === null) throw new Error('no 2d canvas to rasterize the SVG');
		context.drawImage(image, 0, 0, size.width, size.height);
		const png = await canvas.convertToBlob({ type: 'image/png' });
		return new Uint8Array(await png.arrayBuffer());
	} finally {
		URL.revokeObjectURL(url);
	}
}
