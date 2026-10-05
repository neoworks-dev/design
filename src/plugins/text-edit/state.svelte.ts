import type { NodeId, TextStyle } from '../../lib/document/types';
import type { TextPosition } from '../../lib/document/text';
import type { TextSelection } from '../../lib/text/editing';

export interface Composition {
	/** Where the IME text starts. */
	start: TextPosition;
	/** UTF-16 length of the composing text in the document. */
	length: number;
}

/** The reactive state of the editing session. Not a Service, so runes are fine. */
export class TextEditState {
	nodeId = $state<NodeId | null>(null);
	selection = $state.raw<TextSelection>({
		anchor: { paragraph: 0, offset: 0 },
		focus: { paragraph: 0, offset: 0 }
	});
	/** Style delta typed at a collapsed caret (Ctrl+B with nothing selected). */
	typingStyle = $state.raw<Partial<TextStyle> | null>(null);
	composition = $state.raw<Composition | null>(null);
	/** Restarts the caret blink whenever the caret moves or text is typed. */
	activity = $state(0);
}
