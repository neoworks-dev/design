// Key chords: parsing `Mod+Shift+\`, matching keyboard events and formatting accelerators.
// Pure: no kernel, no Svelte, no DOM (events are described by `KeyEventLike`).
//
// Written form: modifiers joined with `+`, then one key. `Mod` is Cmd on macOS and Ctrl elsewhere.
// Keys: letters, digits, punctuation (`[ ] \ - = , . / ; ' \``), `Plus`, and the names Space,
// Enter, Tab, Escape, Backspace, Delete, Arrow*, Home, End, PageUp, PageDown, F1..F12.
//
// A chord is canonicalised to `ctrl+meta+alt+shift+key` (modifiers in that order, lower case,
// `Mod` resolved for the platform) so that equality of strings is equality of chords.

export type Platform = string;

export interface KeyEventLike {
	key: string;
	code?: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	repeat?: boolean;
}

export class ChordError extends Error {
	constructor(
		readonly chord: string,
		reason: string
	) {
		super(`invalid key chord "${chord}": ${reason}`);
		this.name = 'ChordError';
	}
}

const PUNCTUATION_BY_CODE: Record<string, string> = {
	BracketLeft: '[',
	BracketRight: ']',
	Backslash: '\\',
	Minus: '-',
	Equal: '=',
	Comma: ',',
	Period: '.',
	Slash: '/',
	Semicolon: ';',
	Quote: "'",
	Backquote: '`'
};

const KEY_ALIASES: Record<string, string> = {
	' ': 'space',
	spacebar: 'space',
	esc: 'escape',
	del: 'delete',
	return: 'enter',
	plus: '+',
	up: 'arrowup',
	down: 'arrowdown',
	left: 'arrowleft',
	right: 'arrowright'
};

const NAMED_KEYS = [
	'space',
	'enter',
	'tab',
	'escape',
	'backspace',
	'delete',
	'arrowup',
	'arrowdown',
	'arrowleft',
	'arrowright',
	'home',
	'end',
	'pageup',
	'pagedown'
];

export function isMacPlatform(platform: Platform): boolean {
	return platform === 'darwin';
}

function normalizeKeyName(raw: string): string {
	const lowered = raw.toLowerCase();
	return KEY_ALIASES[lowered] ?? lowered;
}

function isValidKey(key: string): boolean {
	if (key.length === 1) return true;
	if (NAMED_KEYS.includes(key)) return true;
	return /^f([1-9]|1[0-2])$/.test(key);
}

interface Modifiers {
	ctrl: boolean;
	meta: boolean;
	alt: boolean;
	shift: boolean;
}

function canonicalize(modifiers: Modifiers, key: string): string {
	const parts: string[] = [];
	if (modifiers.ctrl) parts.push('ctrl');
	if (modifiers.meta) parts.push('meta');
	if (modifiers.alt) parts.push('alt');
	if (modifiers.shift) parts.push('shift');
	parts.push(key);
	return parts.join('+');
}

/** Canonical chord for the written form `text`, with `Mod` resolved for `platform`. */
export function parseChord(text: string, platform: Platform): string {
	const parts = splitChord(text);
	const modifiers: Modifiers = { ctrl: false, meta: false, alt: false, shift: false };
	for (const part of parts.slice(0, -1)) applyModifier(text, part, modifiers, platform);
	const key = normalizeKeyName(parts[parts.length - 1]);
	if (!isValidKey(key)) throw new ChordError(text, `unknown key "${parts[parts.length - 1]}"`);
	return canonicalize(modifiers, key);
}

// "Mod++" and "Mod+Plus" both mean Mod and the plus key; a plain split would lose the last one.
function splitChord(text: string): string[] {
	if (text.length === 0) throw new ChordError(text, 'empty');
	if (text === '+') return ['+'];
	if (text.endsWith('++')) return [...text.slice(0, -2).split('+'), '+'];
	const parts = text.split('+');
	if (parts.some((part) => part.length === 0)) throw new ChordError(text, 'empty segment');
	return parts;
}

function applyModifier(text: string, name: string, modifiers: Modifiers, platform: Platform): void {
	switch (name.toLowerCase()) {
		case 'mod':
			if (isMacPlatform(platform)) modifiers.meta = true;
			else modifiers.ctrl = true;
			return;
		case 'ctrl':
		case 'control':
			modifiers.ctrl = true;
			return;
		case 'meta':
		case 'cmd':
		case 'super':
			modifiers.meta = true;
			return;
		case 'alt':
		case 'option':
			modifiers.alt = true;
			return;
		case 'shift':
			modifiers.shift = true;
			return;
		default:
			throw new ChordError(text, `unknown modifier "${name}"`);
	}
}

function keyFromEvent(event: KeyEventLike): string {
	const code = event.code;
	if (code) {
		if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
		if (/^Digit[0-9]$/.test(code)) return code.slice(5);
		const punctuation = PUNCTUATION_BY_CODE[code];
		if (punctuation) return punctuation;
	}
	return normalizeKeyName(event.key);
}

/** Canonical chord of a keyboard event (same form as `parseChord`). */
export function chordFromEvent(event: KeyEventLike): string {
	return canonicalize(
		{ ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey },
		keyFromEvent(event)
	);
}

/** Key part of a canonical chord (what a key-up event identifies for hold bindings). */
export function chordKey(chord: string): string {
	if (chord.length === 1) return chord;
	const index = chord.lastIndexOf('+', chord.length - 2);
	if (index < 0) return chord;
	return chord.slice(index + 1);
}

const MAC_SYMBOLS: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };
// macOS writes modifiers as ⌃⌥⇧⌘.
const MAC_ORDER = ['ctrl', 'alt', 'shift', 'meta'];
const DISPLAY_NAMES: Record<string, string> = {
	arrowup: 'Up',
	arrowdown: 'Down',
	arrowleft: 'Left',
	arrowright: 'Right',
	pageup: 'PageUp',
	pagedown: 'PageDown'
};

function displayKey(key: string): string {
	const named = DISPLAY_NAMES[key];
	if (named) return named;
	if (key.length === 1) return key.toUpperCase();
	return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Human readable accelerator of a canonical chord: `Ctrl+Shift+\` or `⇧⌘\`. */
export function formatChord(chord: string, platform: Platform): string {
	const key = chordKey(chord);
	const modifiers = chord
		.slice(0, chord.length - key.length)
		.split('+')
		.filter(Boolean);
	if (isMacPlatform(platform)) {
		const ordered = MAC_ORDER.filter((modifier) => modifiers.includes(modifier));
		return ordered.map((modifier) => MAC_SYMBOLS[modifier]).join('') + displayKey(key);
	}
	const names = modifiers.map((modifier) => displayKey(modifier === 'meta' ? 'win' : modifier));
	return [...names, displayKey(key)].join('+');
}

const ELECTRON_KEY_NAMES: Record<string, string> = {
	'+': 'Plus',
	space: 'Space',
	enter: 'Enter',
	tab: 'Tab',
	escape: 'Esc',
	backspace: 'Backspace',
	delete: 'Delete',
	arrowup: 'Up',
	arrowdown: 'Down',
	arrowleft: 'Left',
	arrowright: 'Right',
	home: 'Home',
	end: 'End',
	pageup: 'PageUp',
	pagedown: 'PageDown'
};

const ELECTRON_MODIFIERS: Record<string, string> = {
	ctrl: 'Ctrl',
	meta: 'Cmd',
	alt: 'Alt',
	shift: 'Shift'
};

/** A canonical chord in the accelerator syntax of native menus (`Ctrl+Shift+K`). */
export function toElectronAccelerator(chord: string): string {
	const key = chordKey(chord);
	const modifiers = chord
		.slice(0, chord.length - key.length)
		.split('+')
		.filter(Boolean);
	const names = modifiers.map((modifier) => ELECTRON_MODIFIERS[modifier]);
	const keyName = ELECTRON_KEY_NAMES[key];
	if (keyName) names.push(keyName);
	else names.push(key.toUpperCase());
	return names.join('+');
}
