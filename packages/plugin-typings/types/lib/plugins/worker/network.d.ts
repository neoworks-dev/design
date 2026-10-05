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
export declare function createNetworkApi(env: SdkEnv): NetworkApi;
