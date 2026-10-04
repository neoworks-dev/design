// Test helper (not shipped): builds a tiny but structurally valid sfnt that carries only a `name`
// table, enough for the scanner.

function utf16be(text: string): number[] {
	const bytes: number[] = [];
	for (const char of text) {
		const code = char.charCodeAt(0);
		bytes.push(code >> 8, code & 0xff);
	}
	return bytes;
}

function ascii(text: string): number[] {
	return text.split('').map((char) => char.charCodeAt(0));
}

function uint16(value: number): number[] {
	return [value >> 8, value & 0xff];
}

function uint32(value: number): number[] {
	return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

export interface TestNameRecord {
	platform: number;
	language: number;
	nameId: number;
	text: string;
}

export function buildSfnt(records: TestNameRecord[], magic = 0x00010000): Uint8Array {
	const strings: number[] = [];
	const encoded = records.map((record) => {
		const bytes = record.platform === 1 ? ascii(record.text) : utf16be(record.text);
		const offset = strings.length;
		strings.push(...bytes);
		return { record, length: bytes.length, offset };
	});
	const stringOffset = 6 + records.length * 12;
	const table = [...uint16(0), ...uint16(records.length), ...uint16(stringOffset)];
	for (const { record, length, offset } of encoded) {
		table.push(
			...uint16(record.platform),
			...uint16(0),
			...uint16(record.language),
			...uint16(record.nameId),
			...uint16(length),
			...uint16(offset)
		);
	}
	table.push(...strings);
	const tableOffset = 12 + 16;
	const directory = [
		...uint32(magic),
		...uint16(1),
		...uint16(16),
		...uint16(0),
		...uint16(0),
		...ascii('name'),
		...uint32(0),
		...uint32(tableOffset),
		...uint32(table.length)
	];
	return new Uint8Array([...directory, ...table]);
}

/** A font file named `family` / `style` through the Windows English name records (1 and 2). */
export function simpleFont(family: string, style: string): Uint8Array {
	return buildSfnt([
		{ platform: 3, language: 0x409, nameId: 1, text: family },
		{ platform: 3, language: 0x409, nameId: 2, text: style }
	]);
}
