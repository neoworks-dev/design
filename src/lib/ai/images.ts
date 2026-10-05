// Turning pasted files into images a prompt can carry (`AiImage`, base64 without the data: prefix).

import type { AiImage } from '../../../electron/bridge';

/** The formats every harness takes as image input. */
export const PROMPT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Larger files are refused: `ai:send` caps one image at 16 MB of base64. */
export const MAXIMUM_IMAGE_BYTES = 10 * 1024 * 1024;

/** The image files among what was pasted, in clipboard order. */
export function pastedImageFiles(data: DataTransfer | null): File[] {
	if (data === null) return [];
	return [...data.files].filter((file) => PROMPT_IMAGE_TYPES.includes(file.type));
}

export async function imageOfFile(file: File): Promise<AiImage> {
	if (!PROMPT_IMAGE_TYPES.includes(file.type)) {
		throw new Error(`${file.type || 'this file'} is not an image the assistant can read`);
	}
	if (file.size > MAXIMUM_IMAGE_BYTES) throw new Error('the image is larger than 10 MB');
	const bytes = new Uint8Array(await file.arrayBuffer());
	return { mimeType: file.type, data: base64Of(bytes) };
}

/** A `data:` URL to show the image in an `<img>`. */
export function imageUrl(image: AiImage): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

function base64Of(bytes: Uint8Array): string {
	// btoa takes a binary string; build it in chunks so large images do not overflow the stack.
	const chunkSize = 0x8000;
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}
