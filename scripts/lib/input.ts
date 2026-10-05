import type { CdpSession } from './cdp';

export interface Point {
	x: number;
	y: number;
}

export type MouseButton = 'left' | 'right' | 'middle';

const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

const NAMED_KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
	Enter: { code: 'Enter', keyCode: 13, text: '\r' },
	Escape: { code: 'Escape', keyCode: 27 },
	Tab: { code: 'Tab', keyCode: 9 },
	Backspace: { code: 'Backspace', keyCode: 8 },
	Delete: { code: 'Delete', keyCode: 46 },
	Space: { code: 'Space', keyCode: 32, text: ' ' },
	ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
	ArrowUp: { code: 'ArrowUp', keyCode: 38 },
	ArrowRight: { code: 'ArrowRight', keyCode: 39 },
	ArrowDown: { code: 'ArrowDown', keyCode: 40 },
	Home: { code: 'Home', keyCode: 36 },
	End: { code: 'End', keyCode: 35 },
	PageUp: { code: 'PageUp', keyCode: 33 },
	PageDown: { code: 'PageDown', keyCode: 34 },
	Alt: { code: 'AltLeft', keyCode: 18 },
	Control: { code: 'ControlLeft', keyCode: 17 },
	Meta: { code: 'MetaLeft', keyCode: 91 },
	Shift: { code: 'ShiftLeft', keyCode: 16 }
};

export async function click(
	cdp: CdpSession,
	point: Point,
	button: MouseButton = 'left',
	clickCount = 1
): Promise<void> {
	await mouse(cdp, 'mouseMoved', point, 'none', 0);
	for (let count = 1; count <= clickCount; count += 1) {
		await mouse(cdp, 'mousePressed', point, button, count);
		await mouse(cdp, 'mouseReleased', point, button, count);
	}
}

// Stepped so pointermove handlers that accumulate deltas see the whole drag.
export async function drag(cdp: CdpSession, from: Point, to: Point, steps = 12): Promise<void> {
	await mouse(cdp, 'mouseMoved', from, 'none', 0);
	await mouse(cdp, 'mousePressed', from, 'left', 1);
	for (let step = 1; step <= steps; step += 1) {
		const progress = step / steps;
		const point = {
			x: from.x + (to.x - from.x) * progress,
			y: from.y + (to.y - from.y) * progress
		};
		await mouse(cdp, 'mouseMoved', point, 'left', 0, 1);
	}
	await mouse(cdp, 'mouseReleased', to, 'left', 1);
}

export async function scroll(
	cdp: CdpSession,
	point: Point,
	deltaY: number,
	deltaX = 0
): Promise<void> {
	await cdp.send('Input.dispatchMouseEvent', {
		type: 'mouseWheel',
		x: point.x,
		y: point.y,
		deltaX,
		deltaY
	});
}

export async function typeText(cdp: CdpSession, text: string): Promise<void> {
	await cdp.send('Input.insertText', { text });
}

// Presses one chord such as "Control+Shift+z", "Escape" or "v".
export async function pressChord(cdp: CdpSession, chord: string): Promise<void> {
	const parts = chord.split('+');
	const keyName = parts[parts.length - 1];
	const modifierNames = parts.slice(0, -1);
	const modifiers = modifierNames.reduce((bits, name) => bits | modifierBit(name), 0);
	const key = describeKey(keyName);
	const hasCommandModifier = (modifiers & ~MODIFIER_BITS.Shift) !== 0;

	const base = {
		key: key.key,
		code: key.code,
		windowsVirtualKeyCode: key.keyCode,
		modifiers
	};
	const text = hasCommandModifier ? undefined : key.text;
	await cdp.send('Input.dispatchKeyEvent', {
		...base,
		type: text ? 'keyDown' : 'rawKeyDown',
		text
	});
	await cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

let heldModifiers = 0;

/** Mouse events carry these modifiers (Alt, Control, Meta, Shift) until `holdModifiers([])`. */
export function holdModifiers(names: string[]): void {
	heldModifiers = names.reduce((bits, name) => bits | modifierBit(name), 0);
}

async function mouse(
	cdp: CdpSession,
	type: string,
	point: Point,
	button: MouseButton | 'none',
	clickCount: number,
	buttons = 0
): Promise<void> {
	await cdp.send('Input.dispatchMouseEvent', {
		type,
		x: point.x,
		y: point.y,
		button,
		buttons,
		clickCount,
		modifiers: heldModifiers
	});
}

function modifierBit(name: string): number {
	const bit = MODIFIER_BITS[name];
	if (bit === undefined)
		throw new Error(`unknown modifier "${name}" (use Alt, Control, Meta, Shift)`);
	return bit;
}

function describeKey(name: string): { key: string; code: string; keyCode: number; text?: string } {
	const named = NAMED_KEYS[name];
	if (named) return { key: name === 'Space' ? ' ' : name, ...named };
	if (name.length !== 1) throw new Error(`unknown key "${name}"`);
	return describeCharacter(name);
}

function describeCharacter(character: string): {
	key: string;
	code: string;
	keyCode: number;
	text: string;
} {
	const upper = character.toUpperCase();
	if (/[A-Z]/.test(upper)) {
		return { key: character, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: character };
	}
	if (/[0-9]/.test(character)) {
		return {
			key: character,
			code: `Digit${character}`,
			keyCode: character.charCodeAt(0),
			text: character
		};
	}
	return { key: character, code: '', keyCode: 0, text: character };
}
