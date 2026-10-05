import type { SdkEnv } from './design';
import type { AiToolRegistration, ApplyOptions, ApplyResult, CodegenBlockData, CodegenRegistration, CommandRegistration, MenuRegistration, NodeOperation, NodeQuery, PluginNode, ToolKeyMessage, ToolPointerMessage, ToolRegistration, ViewportInfo } from '../api/types';
/** Returned by registrations; removes the registration again. */
export interface Disposable {
    dispose(): Promise<void>;
}
export interface DocumentApi {
    /** The node, or `null` when it does not exist. */
    getNode(id: string): Promise<PluginNode | null>;
    /** The children of a node in order; `null` lists the pages. */
    getChildren(id: string | null): Promise<PluginNode[]>;
    query(criteria?: NodeQuery): Promise<PluginNode[]>;
    currentPage(): Promise<PluginNode>;
    pages(): Promise<PluginNode[]>;
    /**
     * Create, set, delete and move layers. Everything one plugin run applies is one undo step
     * (unless `design.commitUndo()` splits it). All operations apply or none do.
     */
    apply(operations: NodeOperation[], options?: ApplyOptions): Promise<ApplyResult>;
    /** Create one layer and answer its id. `props` use Figma-like names: x, y, width, fill, ... */
    createNode(type: Extract<NodeOperation, {
        op: 'create';
    }>['type'], props?: Record<string, unknown>, parentId?: string): Promise<string>;
    setProps(id: string, props: Record<string, unknown>): Promise<void>;
    remove(id: string): Promise<void>;
    /** Shared styles of the document (paint, text, effect, grid). */
    styles(): Promise<unknown[]>;
    /** Variable collections and variables of the document. */
    variables(): Promise<{
        collections: unknown[];
        variables: unknown[];
    }>;
    /**
     * Refuse deleting these layers, by anyone, while the registration lives (the plugin's
     * `before-delete` interception). Removed when the plugin stops.
     */
    protect(ids: string[], reason: string): Promise<Disposable>;
}
export interface SelectionApi {
    /** The ids of the selected layers on the current page. */
    get(): Promise<string[]>;
    /** The selected layers themselves. */
    nodes(): Promise<PluginNode[]>;
    set(ids: string[]): Promise<void>;
}
export interface ViewportApi {
    get(): Promise<ViewportInfo>;
    /** Pan and zoom so the layers fill the canvas. */
    scrollAndZoomIntoView(ids: string[]): Promise<void>;
}
export type CommandHandler = (args: unknown) => unknown;
export interface CommandsApi {
    /**
     * Register a command. The id starts with the plugin id; a command the manifest declares only
     * gets its handler here, any other also appears in the palette with `title`.
     */
    register(id: string, handler: CommandHandler, options?: Omit<CommandRegistration, 'id'>): Promise<Disposable>;
    /** Run any command of the app by id (needs the `document:write` permission). */
    run(id: string, args?: unknown): Promise<void>;
}
export interface MenusApi {
    register(registration: MenuRegistration): Promise<Disposable>;
}
export interface ToolHandlers {
    onActivate?(): void;
    onDeactivate?(): void;
    onPointer?(event: ToolPointerMessage): void;
    onKey?(event: ToolKeyMessage): void;
}
export interface ToolsApi {
    register(registration: ToolRegistration, handlers: ToolHandlers): Promise<Disposable>;
}
export type AiToolHandler = (input: unknown) => unknown;
export interface AiToolsApi {
    /** Offer a function to the AI agent; the answer is JSON-stringified unless it is a string. */
    register(registration: AiToolRegistration, handler: AiToolHandler): Promise<Disposable>;
}
export interface CodegenInputData {
    nodeId: string;
    node: PluginNode;
    options: {
        unit: 'px' | 'rem';
        rootFontSize: number;
    };
}
export type CodegenGenerate = (input: CodegenInputData) => CodegenBlockData[];
export interface CodegenApi {
    register(registration: CodegenRegistration, generate: CodegenGenerate): Promise<Disposable>;
}
export declare function createDocumentApi(env: SdkEnv): DocumentApi;
export declare function createSelectionApi(env: SdkEnv): SelectionApi;
export declare function createViewportApi(env: SdkEnv): ViewportApi;
export declare function createCommandsApi(env: SdkEnv): CommandsApi;
export declare function createMenusApi(env: SdkEnv): MenusApi;
export declare function createToolsApi(env: SdkEnv): ToolsApi;
export declare function createAiToolsApi(env: SdkEnv): AiToolsApi;
export declare function createCodegenApi(env: SdkEnv): CodegenApi;
