// WOFF 1.0 to sfnt. WOFF is an sfnt whose tables are individually zlib-compressed; Skia reads
// plain TrueType / OpenType only, so bundled WOFF files are unpacked before CanvasKit sees them.

const WOFF_SIGNATURE = 0x774f4646;
const HEADER_SIZE = 44;
const TABLE_RECORD_SIZE = 20;

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('deflate'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

function align4(value: number): number {
	return (value + 3) & ~3;
}

/** The sfnt bytes for a WOFF file; input that is not WOFF is returned unchanged. */
export async function woffToSfnt(input: Uint8Array): Promise<Uint8Array> {
	if (input.length < HEADER_SIZE) return input;
	const woff = new DataView(input.buffer, input.byteOffset, input.byteLength);
	if (woff.getUint32(0) !== WOFF_SIGNATURE) return input;
	const flavor = woff.getUint32(4);
	const tableCount = woff.getUint16(12);

	const tables: { tag: number; checksum: number; data: Uint8Array }[] = [];
	for (let index = 0; index < tableCount; index += 1) {
		const at = HEADER_SIZE + index * TABLE_RECORD_SIZE;
		const offset = woff.getUint32(at + 4);
		const compressedLength = woff.getUint32(at + 8);
		const originalLength = woff.getUint32(at + 12);
		const raw = input.subarray(offset, offset + compressedLength);
		const data = compressedLength < originalLength ? await inflate(raw) : raw;
		if (data.length !== originalLength) throw new Error('WOFF table length mismatch');
		tables.push({ tag: woff.getUint32(at), checksum: woff.getUint32(at + 16), data });
	}

	const directorySize = 12 + tableCount * 16;
	let total = directorySize;
	for (const table of tables) total += align4(table.data.length);
	const output = new Uint8Array(total);
	const sfnt = new DataView(output.buffer);
	sfnt.setUint32(0, flavor);
	sfnt.setUint16(4, tableCount);
	let searchRange = 1;
	let entrySelector = 0;
	while (searchRange * 2 <= tableCount) {
		searchRange *= 2;
		entrySelector += 1;
	}
	sfnt.setUint16(6, searchRange * 16);
	sfnt.setUint16(8, entrySelector);
	sfnt.setUint16(10, tableCount * 16 - searchRange * 16);

	// WOFF keeps its table directory sorted by tag, as sfnt requires.
	let cursor = directorySize;
	tables.forEach((table, index) => {
		const at = 12 + index * 16;
		sfnt.setUint32(at, table.tag);
		sfnt.setUint32(at + 4, table.checksum);
		sfnt.setUint32(at + 8, cursor);
		sfnt.setUint32(at + 12, table.data.length);
		output.set(table.data, cursor);
		cursor += align4(table.data.length);
	});
	return output;
}
