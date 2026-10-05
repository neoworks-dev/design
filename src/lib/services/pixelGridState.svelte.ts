// Reactive holder behind the `pixelGrid` service (a Service may not hold runes).

export class PixelGridState {
	/** The grid shows from 800% zoom up while this is on. */
	gridEnabled = $state(true);
	/** Pixel preview rendering is active. */
	previewEnabled = $state(false);
}
