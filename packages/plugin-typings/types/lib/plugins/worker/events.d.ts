export type EventListener = (payload: unknown) => void;
export interface SubscriptionSink {
    subscribe(name: string): void;
    unsubscribe(name: string): void;
}
export declare class EventHub {
    private readonly sink;
    private readonly listeners;
    constructor(sink: SubscriptionSink);
    on(name: string, listener: EventListener): void;
    off(name: string, listener: EventListener): void;
    once(name: string, listener: EventListener): void;
    /** Deliver an event to its listeners; a throwing listener does not stop the others. */
    dispatch(name: string, payload: unknown, onError: (error: unknown) => void): void;
    names(): string[];
}
