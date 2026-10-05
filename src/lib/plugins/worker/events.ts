// The worker-side event hub behind `design.on(...)`. The host only sends the events a plugin has
// subscribed to, so the first listener of an event name tells the host (`events.subscribe`) and
// the last one leaving tells it again (`events.unsubscribe`).

export type EventListener = (payload: unknown) => void;

export interface SubscriptionSink {
	subscribe(name: string): void;
	unsubscribe(name: string): void;
}

export class EventHub {
	private readonly listeners = new Map<string, Set<EventListener>>();

	constructor(private readonly sink: SubscriptionSink) {}

	on(name: string, listener: EventListener): void {
		let set = this.listeners.get(name);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(name, set);
			this.sink.subscribe(name);
		}
		set.add(listener);
	}

	off(name: string, listener: EventListener): void {
		const set = this.listeners.get(name);
		if (set === undefined || !set.delete(listener)) return;
		if (set.size > 0) return;
		this.listeners.delete(name);
		this.sink.unsubscribe(name);
	}

	once(name: string, listener: EventListener): void {
		const wrapper: EventListener = (payload) => {
			this.off(name, wrapper);
			listener(payload);
		};
		this.on(name, wrapper);
	}

	/** Deliver an event to its listeners; a throwing listener does not stop the others. */
	dispatch(name: string, payload: unknown, onError: (error: unknown) => void): void {
		const set = this.listeners.get(name);
		if (set === undefined) return;
		for (const listener of Array.from(set)) {
			try {
				listener(payload);
			} catch (error) {
				onError(error);
			}
		}
	}

	names(): string[] {
		return [...this.listeners.keys()].sort();
	}
}
