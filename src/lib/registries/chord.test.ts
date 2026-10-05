import { describe, expect, it } from 'vitest';
import {
	ChordError,
	chordFromEvent,
	chordKey,
	formatChord,
	parseChord,
	toElectronAccelerator,
	type KeyEventLike
} from './chord';

function event(overrides: Partial<KeyEventLike>): KeyEventLike {
	return {
		key: '',
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...overrides
	};
}

describe('parseChord', () => {
	it('resolves Mod per platform', () => {
		expect(parseChord('Mod+S', 'linux')).toBe('ctrl+s');
		expect(parseChord('Mod+S', 'win32')).toBe('ctrl+s');
		expect(parseChord('Mod+S', 'darwin')).toBe('meta+s');
	});

	it('canonicalises modifier order and case', () => {
		expect(parseChord('shift+alt+Mod+z', 'linux')).toBe('ctrl+alt+shift+z');
		expect(parseChord('Cmd+Option+K', 'darwin')).toBe('meta+alt+k');
	});

	it('supports punctuation, named keys and the plus key', () => {
		expect(parseChord('Mod+\\', 'linux')).toBe('ctrl+\\');
		expect(parseChord('Mod+Shift+\\', 'linux')).toBe('ctrl+shift+\\');
		expect(parseChord('Mod+[', 'linux')).toBe('ctrl+[');
		expect(parseChord('Space', 'linux')).toBe('space');
		expect(parseChord('Enter', 'linux')).toBe('enter');
		expect(parseChord('Shift+Tab', 'linux')).toBe('shift+tab');
		expect(parseChord('Mod++', 'linux')).toBe('ctrl++');
		expect(parseChord('Mod+Plus', 'linux')).toBe('ctrl++');
		expect(parseChord('Shift+1', 'linux')).toBe('shift+1');
		expect(parseChord('F2', 'linux')).toBe('f2');
	});

	it('rejects malformed chords', () => {
		for (const chord of ['', 'Mod+', 'Banana+S', 'Mod+Nope', '+S']) {
			expect(() => parseChord(chord, 'linux'), chord).toThrow(ChordError);
		}
	});
});

describe('chordFromEvent', () => {
	it('uses the physical letter and digit so Shift and Option do not change the key', () => {
		expect(chordFromEvent(event({ key: 'V', code: 'KeyV', shiftKey: true }))).toBe('shift+v');
		expect(chordFromEvent(event({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('shift+1');
		expect(chordFromEvent(event({ key: 'å', code: 'KeyA', altKey: true }))).toBe('alt+a');
	});

	it('maps punctuation codes', () => {
		expect(
			chordFromEvent(event({ key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true }))
		).toBe('ctrl+shift+\\');
		expect(chordFromEvent(event({ key: '{', code: 'BracketLeft', ctrlKey: true }))).toBe('ctrl+[');
	});

	it('falls back to key names without a code', () => {
		expect(chordFromEvent(event({ key: ' ' }))).toBe('space');
		expect(chordFromEvent(event({ key: 'Escape' }))).toBe('escape');
		expect(chordFromEvent(event({ key: 'ArrowUp', shiftKey: true }))).toBe('shift+arrowup');
	});

	it('round-trips with parseChord', () => {
		const written = parseChord('Mod+Shift+\\', 'linux');
		const fromEvent = chordFromEvent(
			event({ key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true })
		);
		expect(fromEvent).toBe(written);
	});
});

describe('formatChord and chordKey', () => {
	it('formats for linux and mac', () => {
		expect(formatChord('ctrl+shift+\\', 'linux')).toBe('Ctrl+Shift+\\');
		expect(formatChord('meta+shift+\\', 'darwin')).toBe('⇧⌘\\');
		expect(formatChord('space', 'linux')).toBe('Space');
		expect(formatChord('arrowup', 'linux')).toBe('Up');
	});

	it('extracts the key part', () => {
		expect(chordKey('ctrl+shift+z')).toBe('z');
		expect(chordKey('ctrl++')).toBe('+');
		expect(chordKey('+')).toBe('+');
		expect(chordKey('space')).toBe('space');
	});
});

describe('toElectronAccelerator', () => {
	it('writes modifiers and keys the way native menus expect', () => {
		expect(toElectronAccelerator('ctrl+shift+k')).toBe('Ctrl+Shift+K');
		expect(toElectronAccelerator('meta+alt+arrowup')).toBe('Cmd+Alt+Up');
		expect(toElectronAccelerator('escape')).toBe('Esc');
		expect(toElectronAccelerator('ctrl++')).toBe('Ctrl+Plus');
		expect(toElectronAccelerator('f5')).toBe('F5');
		expect(toElectronAccelerator(parseChord('Mod+/', 'linux'))).toBe('Ctrl+/');
	});
});
