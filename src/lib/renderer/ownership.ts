// Skia objects live in wasm memory: forgetting `delete()` leaks until the page dies. Everything
// this codebase creates goes through a SkiaTracker, which counts live objects (the leak counter
// tests assert on) and hands out scopes that delete a batch of temporaries together.

export interface Deletable {
	delete(): void;
}

export class SkiaTracker {
	private readonly live = new Set<Deletable>();
	private created = 0;

	/** Objects created through this tracker and not deleted yet. */
	get liveCount(): number {
		return this.live.size;
	}

	/** Objects ever created through this tracker. */
	get createdCount(): number {
		return this.created;
	}

	/** Start counting `object`; its `delete()` stops the count. Returns the same object. */
	track<T extends Deletable>(object: T): T {
		if (this.live.has(object)) return object;
		this.live.add(object);
		this.created += 1;
		const original = object.delete.bind(object);
		Object.defineProperty(object, 'delete', {
			configurable: true,
			value: (): void => {
				if (!this.live.delete(object)) return;
				original();
			}
		});
		return object;
	}

	/** A batch of temporaries: everything `own`ed is deleted by `dispose`, newest first. */
	scope(): SkiaScope {
		return new SkiaScope(this);
	}
}

export class SkiaScope {
	private readonly owned: Deletable[] = [];

	constructor(private readonly tracker: SkiaTracker) {}

	own<T extends Deletable>(object: T): T {
		this.tracker.track(object);
		this.owned.push(object);
		return object;
	}

	/** `own` for factories that may return null (CanvasKit does when it cannot build). */
	ownOrNull<T extends Deletable>(object: T | null): T | null {
		if (object === null) return null;
		return this.own(object);
	}

	dispose(): void {
		while (this.owned.length > 0) {
			const object = this.owned.pop();
			if (object) object.delete();
		}
	}
}
