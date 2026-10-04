import type { Modifiers } from '../../lib/tools/protocol';

/** Which modifier keys are down right now; reactive so tools can change cursor or hints on it. */
export class ModifierState implements Modifiers {
	shiftKey = $state(false);
	altKey = $state(false);
	ctrlKey = $state(false);
	metaKey = $state(false);

	update(source: Modifiers): void {
		this.shiftKey = source.shiftKey;
		this.altKey = source.altKey;
		this.ctrlKey = source.ctrlKey;
		this.metaKey = source.metaKey;
	}

	reset(): void {
		this.update({ shiftKey: false, altKey: false, ctrlKey: false, metaKey: false });
	}
}
