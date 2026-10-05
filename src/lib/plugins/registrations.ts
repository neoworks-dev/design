// Registrations a plugin made at run time (a command, a menu item, an inspector section), by
// handle, so the worker can release one before it stops (`registrations.release`). Everything left
// is removed anyway when the worker's fiber unloads; this is only for early removal.

import type { PluginConnection } from './connection';

export class RegistrationBook {
	private readonly books = new WeakMap<PluginConnection, Map<number, () => unknown>>();
	private counter = 0;

	/** Remember how to undo a registration; the answer to the worker carries the handle. */
	add(connection: PluginConnection, release: () => unknown): { handle: number } {
		let book = this.books.get(connection);
		if (book === undefined) {
			book = new Map();
			this.books.set(connection, book);
		}
		this.counter += 1;
		book.set(this.counter, release);
		return { handle: this.counter };
	}

	release(connection: PluginConnection, handle: number): void {
		const book = this.books.get(connection);
		const release = book?.get(handle);
		if (release === undefined) return;
		book?.delete(handle);
		void release();
	}
}
