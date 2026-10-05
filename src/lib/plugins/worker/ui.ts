// `design.ui`: the plugin's declarative UI. A plugin describes a surface as a tree (see
// ../surface.ts) with functions where it wants to hear about input; this module turns the
// functions into handler ids, sends the tree to the host once and later only patches, and runs the
// right function when the host reports an event.
//
// Handler ids are made from the node's position and the property (`0.2:onClick`), so a re-render
// that does not change a node sends nothing for it; the table of functions is replaced on every
// render, so a handler always closes over the latest state.

import {
	applySurfacePatch,
	diffSurface,
	type SurfaceNode,
	type UiHandler,
	type UiNode
} from '../surface';
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

interface SurfaceState {
	wire: SurfaceNode | null;
	handlers: Map<string, UiHandler>;
	version: number;
	/** Renders of one surface run one after the other, so patches reach the host in order. */
	tail: Promise<unknown>;
}

function isHandlerKey(key: string): boolean {
	return key.length > 2 && key.startsWith('on') && key[2] === key[2].toUpperCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Replace the handler functions of `tree` with ids; the functions go to `handlers`. */
export function toWireTree(
	tree: UiNode,
	handlers: Map<string, UiHandler>,
	path: readonly number[] = []
): SurfaceNode {
	const wire: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(tree)) {
		if (key === 'children' && Array.isArray(value)) {
			wire.children = value.map((child, index) =>
				toWireTree(child as UiNode, handlers, [...path, index])
			);
		} else if (isHandlerKey(key) && typeof value === 'function') {
			const id = `${path.join('.')}:${key}`;
			handlers.set(id, value as UiHandler);
			wire[key] = id;
		} else {
			wire[key] = value;
		}
	}
	return wire as unknown as SurfaceNode;
}

function readField(source: unknown, key: string): unknown {
	if (!isPlainObject(source)) return undefined;
	return source[key];
}

export function createUiApi(env: SdkEnv): UiApi {
	const surfaces = new Map<string, SurfaceState>();
	const stateOf = (surfaceId: string): SurfaceState => {
		let state = surfaces.get(surfaceId);
		if (state === undefined) {
			state = { wire: null, handlers: new Map(), version: 0, tail: Promise.resolve() };
			surfaces.set(surfaceId, state);
		}
		return state;
	};

	env.handle('ui.event', async (params) => {
		const surfaceId = readField(params, 'surface');
		const handlerId = readField(params, 'handler');
		if (typeof surfaceId !== 'string' || typeof handlerId !== 'string') return;
		const handler = surfaces.get(surfaceId)?.handlers.get(handlerId);
		if (handler === undefined) return;
		await (handler as (value: unknown) => unknown)(readField(params, 'value'));
	});
	const render = async (surfaceId: string, tree: UiNode): Promise<void> => {
		const state = stateOf(surfaceId);
		const handlers = new Map<string, UiHandler>();
		const wire = toWireTree(tree, handlers);
		state.handlers = handlers;
		const previous = state.wire;
		if (previous !== null) {
			const ops = diffSurface(previous, wire);
			if (ops.length === 0) return;
			try {
				await env.call('ui.patch', { surface: surfaceId, version: state.version + 1, ops });
				state.version += 1;
				state.wire = applySurfacePatch(previous, ops);
				return;
			} catch {
				// Out of step with the host (it lost the surface): fall through to a full render.
			}
		}
		await env.call('ui.set', { surface: surfaceId, tree: wire });
		state.version = 1;
		state.wire = wire;
	};

	const call = async (method: string, params: unknown): Promise<void> => {
		await env.call(method, params);
	};

	return {
		set: (surfaceId, tree) => {
			const state = stateOf(surfaceId);
			const result = state.tail.then(() => render(surfaceId, tree));
			state.tail = result.catch(() => undefined);
			return result;
		},
		show: (surfaceId) => call('ui.show', { surface: surfaceId }),
		hide: (surfaceId) => call('ui.hide', { surface: surfaceId }),
		close: (surfaceId) => call('ui.hide', { surface: surfaceId }),
		resize: (surfaceId, size) => call('ui.resize', { surface: surfaceId, ...size }),
		showModal: (surfaceId, options) => call('ui.showModal', { surface: surfaceId, ...options }),
		registerInspector: async (registration) => {
			const answer = await env.call<{ handle: number }>('ui.registerInspector', registration);
			let released = false;
			return {
				dispose: async () => {
					if (released) return;
					released = true;
					await env.call('registrations.release', { handle: answer.handle });
				}
			};
		}
	};
}
