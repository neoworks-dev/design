import { type SurfaceNode, type UiHandler, type UiNode } from '../surface';
import type { SdkEnv } from './design';
import type { Disposable } from './namespaces';
export interface UiSize {
    width: number;
    height: number;
}
export interface ModalOptions {
    title: string;
    width?: number;
    height?: number;
}
export interface InspectorRegistration {
    /** Starts with the plugin id; also the surface that fills the section. */
    id: string;
    title: string;
    tab?: string;
    /** Node types the section applies to; any selection when absent. */
    nodeTypes?: string[];
}
export interface UiApi {
    /**
     * Show `tree` in the surface `surfaceId`: a panel the manifest declares, a modal, an inspector
     * section. The first call sends the whole tree, later calls only what changed.
     */
    set(surfaceId: string, tree: UiNode): Promise<void>;
    /** Show a hidden modal again, or bring a panel to the front. */
    show(surfaceId: string): Promise<void>;
    hide(surfaceId: string): Promise<void>;
    /** Close a modal (same as `hide`). */
    close(surfaceId: string): Promise<void>;
    resize(surfaceId: string, size: UiSize): Promise<void>;
    /** Open the surface as a modal dialog. */
    showModal(surfaceId: string, options: ModalOptions): Promise<void>;
    /** Add a section to the inspector, filled by the surface with the same id. */
    registerInspector(registration: InspectorRegistration): Promise<Disposable>;
}
/** Replace the handler functions of `tree` with ids; the functions go to `handlers`. */
export declare function toWireTree(tree: UiNode, handlers: Map<string, UiHandler>, path?: readonly number[]): SurfaceNode;
export declare function createUiApi(env: SdkEnv): UiApi;
