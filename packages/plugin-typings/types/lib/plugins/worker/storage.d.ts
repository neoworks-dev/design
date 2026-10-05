import type { SdkEnv } from './design';
export interface ClientStorageApi {
    /** The stored value, or `undefined` when there is none. */
    get(key: string): Promise<unknown>;
    /** Any JSON value; a plugin may keep up to 5 MB. */
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
}
export interface StorageApi {
    /** Private data of this plugin on a node; `''` when the key is not set. */
    getData(nodeId: string, key: string): Promise<string>;
    /** Set private data; the empty string deletes the key. An entry may be up to 100 kB. */
    setData(nodeId: string, key: string, value: string): Promise<void>;
    dataKeys(nodeId: string): Promise<string[]>;
    /** Data any plugin may read and write under `namespace` (at least 3 letters or digits). */
    getSharedData(nodeId: string, namespace: string, key: string): Promise<string>;
    setSharedData(nodeId: string, namespace: string, key: string, value: string): Promise<void>;
    sharedDataKeys(nodeId: string, namespace: string): Promise<string[]>;
    /** Commands the node offers to run this plugin again: command id to button label. */
    getRelaunchData(nodeId: string): Promise<Record<string, string>>;
    setRelaunchData(nodeId: string, data: Record<string, string>): Promise<void>;
    readonly clientStorage: ClientStorageApi;
}
export declare function createStorageApi(env: SdkEnv): StorageApi;
