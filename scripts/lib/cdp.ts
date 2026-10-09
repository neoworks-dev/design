// Minimal Chrome DevTools Protocol client for driving the Electron renderer or a Chromium tab.
// Both expose CDP via --remote-debugging-port; no Playwright needed.

interface Target {
	type: string;
	url: string;
	title: string;
	webSocketDebuggerUrl: string;
}

interface PendingCall {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

interface CdpResponse {
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { message: string };
}

type EventListener = (params: Record<string, unknown>) => void;

export class CdpSession {
	private socket: WebSocket;
	private nextId = 1;
	private pending = new Map<number, PendingCall>();
	private listeners = new Map<string, Set<EventListener>>();

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.addEventListener('message', (event) => this.handleMessage(String(event.data)));
	}

	static async connect(
		port: number,
		matches: (target: Target) => boolean = isAppPage
	): Promise<CdpSession> {
		const target = await findPage(port, matches);
		const socket = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener('open', () => resolve(), { once: true });
			socket.addEventListener('error', () => reject(new Error('CDP socket failed')), {
				once: true
			});
		});
		return new CdpSession(socket);
	}

	send<Result = Record<string, unknown>>(
		method: string,
		params: Record<string, unknown> = {}
	): Promise<Result> {
		const id = this.nextId;
		this.nextId += 1;
		const response = new Promise<Result>((resolve, reject) => {
			this.pending.set(id, { resolve: (value) => resolve(value as Result), reject });
		});
		this.socket.send(JSON.stringify({ id, method, params }));
		return response;
	}

	// Evaluates an expression in the page; promises are awaited, the result returned by value.
	async evaluate(expression: string): Promise<unknown> {
		const response = await this.send<{
			result: { value?: unknown };
			exceptionDetails?: { text: string; exception?: { description?: string } };
		}>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
		if (response.exceptionDetails) {
			const details = response.exceptionDetails;
			throw new Error(details.exception?.description || details.text);
		}
		return response.result.value;
	}

	/** Subscribes to a CDP event such as `Runtime.consoleAPICalled`; returns the unsubscriber. */
	on(method: string, listener: EventListener): () => void {
		let listeners = this.listeners.get(method);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(method, listeners);
		}
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	close(): void {
		this.socket.close();
	}

	private handleMessage(raw: string): void {
		const message: CdpResponse = JSON.parse(raw);
		if (message.method) {
			this.dispatchEvent(message.method, message.params || {});
			return;
		}
		if (message.id === undefined) return;
		const call = this.pending.get(message.id);
		if (!call) return;
		this.pending.delete(message.id);
		if (message.error) {
			call.reject(new Error(message.error.message));
			return;
		}
		call.resolve(message.result);
	}

	private dispatchEvent(method: string, params: Record<string, unknown>): void {
		const listeners = this.listeners.get(method);
		if (!listeners) return;
		for (const listener of listeners) listener(params);
	}
}

export type { Target };

export async function listTargets(port: number): Promise<Target[]> {
	const response = await fetch(`http://127.0.0.1:${port}/json/list`);
	const targets: Target[] = await response.json();
	return targets;
}

async function findPage(port: number, matches: (target: Target) => boolean): Promise<Target> {
	const targets = await listTargets(port);
	const page = targets.find(matches);
	if (!page) throw new Error(`no matching page among CDP targets on port ${port}`);
	return page;
}

// The app window, never a detached devtools page.
export function isAppPage(target: Target): boolean {
	return target.type === 'page' && !target.url.startsWith('devtools://');
}
