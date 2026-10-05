/** Handler references are strings on the wire; the worker SDK keeps the functions. */
export type HandlerRef = string;
export declare const MAX_SURFACE_NODES = 3000;
export declare const MAX_SURFACE_DEPTH = 40;
export type Gap = 'none' | 'sm' | 'md' | 'lg';
export type Tone = 'default' | 'muted' | 'faint' | 'danger' | 'success';
export type ButtonVariant = 'primary' | 'surface' | 'ghost' | 'success' | 'danger';
export interface StackNode<H> {
    type: 'stack';
    direction?: 'row' | 'column';
    gap?: Gap;
    align?: 'start' | 'center' | 'end' | 'stretch';
    children: SurfaceNode<H>[];
}
export interface SectionNode<H> {
    type: 'section';
    title?: string;
    children: SurfaceNode<H>[];
}
export interface TextNode {
    type: 'text';
    text: string;
    tone?: Tone;
    size?: 'sm' | 'md' | 'lg';
    bold?: boolean;
}
export interface DividerNode {
    type: 'divider';
}
export interface ButtonNode<H> {
    type: 'button';
    label: string;
    variant?: ButtonVariant;
    size?: 'sm' | 'md';
    full?: boolean;
    disabled?: boolean;
    onClick?: H;
}
export interface InputNode<H> {
    type: 'input';
    label?: string;
    value: string;
    placeholder?: string;
    inputType?: 'text' | 'number';
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    onChange?: H;
}
export interface SelectNode<H> {
    type: 'select';
    label?: string;
    value: string;
    options: {
        value: string;
        label: string;
    }[];
    disabled?: boolean;
    onChange?: H;
}
export interface ColorNode<H> {
    type: 'color';
    label?: string;
    /** `#rrggbb`. */
    value: string;
    onChange?: H;
}
export interface CheckboxNode<H> {
    type: 'checkbox';
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange?: H;
}
export interface ListNode<H> {
    type: 'list';
    children: SurfaceNode<H>[];
}
export interface ImageNode {
    type: 'image';
    /** An inline `data:image/...;base64,` URL; nothing is fetched. */
    src: string;
    alt: string;
    width?: number;
    height?: number;
}
export interface TabNode<H> {
    type: 'tab';
    id: string;
    label: string;
    children: SurfaceNode<H>[];
}
export interface TabsNode<H> {
    type: 'tabs';
    /** The selected tab id; the first tab when absent. */
    value?: string;
    onChange?: H;
    children: TabNode<H>[];
}
export type SurfaceNode<H = HandlerRef> = StackNode<H> | SectionNode<H> | TextNode | DividerNode | ButtonNode<H> | InputNode<H> | SelectNode<H> | ColorNode<H> | CheckboxNode<H> | ListNode<H> | ImageNode | TabsNode<H> | TabNode<H>;
export type SurfaceNodeType = SurfaceNode['type'];
/** A handler a plugin passes while describing its UI; any function of one value. */
export type UiHandler = (value: never) => unknown;
/** What a plugin writes: the same tree with functions where the wire has handler references. */
export type UiNode = SurfaceNode<UiHandler>;
export declare const SURFACE_NODE_TYPES: readonly SurfaceNodeType[];
export type SurfaceResult = {
    ok: true;
    tree: SurfaceNode;
} | {
    ok: false;
    error: string;
};
/** Validate a tree from a plugin. Rejects the whole tree on the first problem. */
export declare function validateSurface(raw: unknown): SurfaceResult;
export type SurfacePatch = {
    op: 'replace';
    path: number[];
    node: SurfaceNode;
} | {
    op: 'props';
    path: number[];
    set: Record<string, unknown>;
    unset: string[];
} | {
    op: 'insert';
    path: number[];
    index: number;
    node: SurfaceNode;
} | {
    op: 'remove';
    path: number[];
    index: number;
};
/** The patch that turns `previous` into `next`; empty when they are equal. */
export declare function diffSurface(previous: SurfaceNode, next: SurfaceNode): SurfacePatch[];
/**
 * Apply `ops` to a copy of `tree`. Throws when an op addresses a node that is not there; the host
 * then asks the plugin for the whole tree again.
 */
export declare function applySurfacePatch(tree: SurfaceNode, ops: readonly SurfacePatch[]): SurfaceNode;
/** Validate a patched tree again: a patch must not be a way around the schema. */
export declare function validatePatched(tree: SurfaceNode): SurfaceResult;
