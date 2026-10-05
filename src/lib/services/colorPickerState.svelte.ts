import type { ColorPickerRequest } from './colorPicker';
import type { RGBA } from '../document/types';

const RECENT_LIMIT = 12;

/** What the picker popover shows. Not a Service, so runes are fine. */
export class ColorPickerState {
	current = $state.raw<ColorPickerRequest | null>(null);
	recent = $state.raw<RGBA[]>([]);

	remember(color: RGBA): void {
		const others = this.recent.filter(
			(entry) => entry.r !== color.r || entry.g !== color.g || entry.b !== color.b
		);
		this.recent = [color, ...others].slice(0, RECENT_LIMIT);
	}
}
