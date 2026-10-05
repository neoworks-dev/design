// `design.network`: the only way out of the worker. A plugin has no `fetch` of its own (the worker
// lockdown removes it, and the worker's Content-Security-Policy refuses everything else); this
// asks the host, which needs the `network` permission and a host on the manifest's
// `networkAccess.allowedDomains`.

import type { SdkEnv } from './design';

export interface NetworkRequestInit {
	method?: string;
	headers?: Record<string, string>;
	/** Text body; binary bodies are not supported in v1. */
	body?: string;
}

export interface NetworkResponse {
	status: number;
	statusText: string;
	ok: boolean;
	headers: Record<string, string>;
	/** The body as text. */
	text: string;
}

export interface NetworkApi {
	/** Rejects with `PermissionDeniedError` or a `NetworkAccessError` message when not allowed. */
	fetch(url: string, init?: NetworkRequestInit): Promise<NetworkResponse>;
	/** The body parsed as JSON. */
	fetchJson(url: string, init?: NetworkRequestInit): Promise<unknown>;
}

interface HostResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
}

export function createNetworkApi(env: SdkEnv): NetworkApi {
	const request = async (url: string, init?: NetworkRequestInit): Promise<NetworkResponse> => {
		const answer = await env.call<HostResponse>('network.fetch', { url, ...init });
		return {
			status: answer.status,
			statusText: answer.statusText,
			ok: answer.status >= 200 && answer.status < 300,
			headers: answer.headers,
			text: answer.body
		};
	};
	return {
		fetch: request,
		fetchJson: async (url, init) => {
			const response = await request(url, init);
			return JSON.parse(response.text);
		}
	};
}
