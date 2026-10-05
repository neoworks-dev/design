// Key triggers store legacy numeric key codes (Figma's `keyCodes`), the value of
// `KeyboardEvent.keyCode`. This maps them to labels and from keyboard events back to codes.

const NAMED_KEYS: Record<number, string> = {
	8: 'Backspace',
	9: 'Tab',
	13: 'Enter',
	27: 'Escape',
	32: 'Space',
	37: 'Left arrow',
	38: 'Up arrow',
	39: 'Right arrow',
	40: 'Down arrow',
	46: 'Delete'
};

const FIRST_DIGIT = 48;
const LAST_LETTER = 90;

export function keyCodeLabel(keyCode: number): string {
	const named = NAMED_KEYS[keyCode];
	if (named !== undefined) return named;
	if (keyCode >= FIRST_DIGIT && keyCode <= LAST_LETTER) return String.fromCharCode(keyCode);
	return `Key ${keyCode}`;
}
