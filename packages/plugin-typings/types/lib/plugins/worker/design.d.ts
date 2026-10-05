import { EventHub, type EventListener } from './events';
import { type AiToolsApi, type CodegenApi, type CommandsApi, type DocumentApi, type MenusApi, type SelectionApi, type ToolsApi, type ViewportApi } from './namespaces';
import { type NetworkApi } from './network';
import { type StorageApi } from './storage';
import { type UiApi } from './ui';
export declare const SDK_API_VERSION = "1.0";
export type LogLevel = 'info' | 'warn' | 'error';
/** What every module of the SDK is given. */
export interface SdkEnv {
    pluginId: string;
    apiVersion: string;
    /** Call a host API method (`namespace.method`) and await its answer. */
    call<Result = unknown>(method: string, params?: unknown): Promise<Result>;
    events: EventHub;
    /** Answer requests the host sends (`command.run`, `ui.event`, ...); one handler per method. */
    handle(method: string, handler: (params: unknown) => unknown): void;
    /** Report an error of the plugin's own code to the host's plugin console. */
    reportError(error: unknown): void;
    /** Runs a command the plugin registered no handler for (the Figma layer launches its script). */
    fallbackCommand?: (id: string, args: unknown) => Promise<void>;
}
export interface LogApi {
    info(...parts: unknown[]): void;
    warn(...parts: unknown[]): void;
    error(...parts: unknown[]): void;
}
export interface CoreApi {
    readonly pluginId: string;
    /** The plugin API version this app provides. */
    readonly apiVersion: string;
    /** Subscribe to a host event (`selectionchange`, `documentchange`, ...). */
    on(name: string, listener: EventListener): void;
    off(name: string, listener: EventListener): void;
    once(name: string, listener: EventListener): void;
    readonly log: LogApi;
}
/** The whole surface a plugin sees as `design`. */
export interface DesignApi extends CoreApi {
    readonly document: DocumentApi;
    readonly selection: SelectionApi;
    readonly viewport: ViewportApi;
    readonly commands: CommandsApi;
    readonly menus: MenusApi;
    readonly tools: ToolsApi;
    readonly aiTools: AiToolsApi;
    readonly codegen: CodegenApi;
    /** Declarative UI: panels, modals and inspector sections described as trees. */
    readonly ui: UiApi;
    /** HTTP requests through the host: needs `network` and a host on `networkAccess.allowedDomains`. */
    readonly network: NetworkApi;
    /** Data the plugin keeps: on nodes (in the document) and `clientStorage` (on this machine). */
    readonly storage: StorageApi;
    /**
     * End the current undo step: what the plugin changed so far is one step, what it changes next
     * is another. Without it everything one command run changes is a single step.
     */
    commitUndo(): Promise<void>;
}
export declare function createDesign(env: SdkEnv): DesignApi;
