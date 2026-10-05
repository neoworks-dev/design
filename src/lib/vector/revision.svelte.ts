// A reactive counter for overlay contributions whose inputs are plain objects: the tool bumps it
// after every change and the contribution's `track()` reads it, so the overlay redraws.

export class Revision {
	value = $state(0);

	bump(): void {
		this.value += 1;
	}
}
