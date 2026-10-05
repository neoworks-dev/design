/** What the palette is showing. Not a Service, so runes are fine; the service exposes it. */
export class PaletteState {
	open = $state(false);
	query = $state('');
	sourceId = $state('commands');
	/** Highlighted row in the result list. */
	index = $state(0);
	/** Command ids run through the palette, newest first. */
	recent = $state.raw<readonly string[]>([]);
}
