/** A blob URL for exported bytes, for an `<img>` preview. The caller revokes it. */
export function objectUrlFor(bytes: Uint8Array, mimeType: string): string {
	return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
}
