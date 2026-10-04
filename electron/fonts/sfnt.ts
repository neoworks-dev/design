// Minimal sfnt (TrueType / OpenType) reader: just enough of the `name` table to learn a font
// file's family and style without loading the whole file. Pure: it reads through a callback, so
// tests feed it in-memory bytes and the real host feeds it a file handle.

export interface FontName {
	family: string;
	style: string;
}

/** Read `length` bytes at `offset`; may return fewer at end of file. */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

const TAG_TTCF = 0x74746366;
const NAME_FAMILY = 1;
const NAME_STYLE = 2;
const NAME_TYPOGRAPHIC_FAMILY = 16;
const NAME_TYPOGRAPHIC_STYLE = 17;
const MAX_NAME_TABLE = 1 << 20;

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeUtf16be(bytes: Uint8Array): string {
	let text = '';
	for (let at = 0; at + 1 < bytes.length; at += 2) {
		text += String.fromCharCode((bytes[at] << 8) | bytes[at + 1]);
	}
	return text;
}

function decodeLatin1(bytes: Uint8Array): string {
	let text = '';
	for (const byte of bytes) text += String.fromCharCode(byte);
	return text;
}

interface NameRecord {
	platform: number;
	language: number;
	nameId: number;
	text: string;
}

/** Lower is better: Windows English, other Windows, Unicode platform, Macintosh. */
function rank(record: NameRecord): number {
	if (record.platform === 3) return record.language === 0x409 ? 0 : 1;
	if (record.platform === 0) return 2;
	return 3;
}

function pick(records: NameRecord[], ...nameIds: number[]): string | undefined {
	for (const nameId of nameIds) {
		const candidates = records
			.filter((record) => record.nameId === nameId && record.text.trim() !== '')
			.sort((left, right) => rank(left) - rank(right));
		if (candidates.length > 0) return candidates[0].text.trim();
	}
	return undefined;
}

function parseNameTable(table: Uint8Array): NameRecord[] {
	if (table.length < 6) return [];
	const data = view(table);
	const count = data.getUint16(2);
	const stringOffset = data.getUint16(4);
	const records: NameRecord[] = [];
	for (let index = 0; index < count; index += 1) {
		const at = 6 + index * 12;
		if (at + 12 > table.length) break;
		const platform = data.getUint16(at);
		const language = data.getUint16(at + 4);
		const nameId = data.getUint16(at + 6);
		const length = data.getUint16(at + 8);
		const offset = stringOffset + data.getUint16(at + 10);
		if (offset + length > table.length) continue;
		const raw = table.subarray(offset, offset + length);
		const text = platform === 1 ? decodeLatin1(raw) : decodeUtf16be(raw);
		records.push({ platform, language, nameId, text });
	}
	return records;
}

async function readFont(read: ByteReader): Promise<FontName | null> {
	const header = await read(0, 12);
	if (header.length < 12) return null;
	const tableCount = view(header).getUint16(4);
	const directory = await read(12, tableCount * 16);
	if (directory.length < tableCount * 16) return null;
	const entries = view(directory);
	for (let index = 0; index < tableCount; index += 1) {
		const at = index * 16;
		const tag = String.fromCharCode(...directory.subarray(at, at + 4));
		if (tag !== 'name') continue;
		const offset = entries.getUint32(at + 8);
		const length = entries.getUint32(at + 12);
		if (length > MAX_NAME_TABLE) return null;
		const records = parseNameTable(await read(offset, length));
		const family = pick(records, NAME_TYPOGRAPHIC_FAMILY, NAME_FAMILY);
		if (family === undefined) return null;
		const style = pick(records, NAME_TYPOGRAPHIC_STYLE, NAME_STYLE);
		return { family, style: style === undefined ? 'Regular' : style };
	}
	return null;
}

/**
 * Family and style of a single-font `.ttf` / `.otf` file. Collections (`.ttc`) and anything that
 * is not an sfnt yield `null`: a collection's faces cannot be addressed by file alone.
 */
export async function readFontName(read: ByteReader): Promise<FontName | null> {
	const magic = await read(0, 4);
	if (magic.length < 4) return null;
	const tag = view(magic).getUint32(0);
	if (tag === TAG_TTCF) return null;
	const isSfnt = tag === 0x00010000 || tag === 0x4f54544f || tag === 0x74727565;
	if (!isSfnt) return null;
	return readFont(read);
}
