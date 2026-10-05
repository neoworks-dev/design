// The `figma` global of the Figma compatibility layer: the part of Figma's plugin API that maps
// onto this app, built from `design` in the worker so existing Figma plugins run with no changes.
// A plugin that mentions `figma` gets it (see runtime.ts); the others never pay for it.
//
// A Figma plugin is one script run once per launch. Here that script is a run: it starts when the
// worker loads the plugin (the host opens one undo step), the layer sends everything the script
// changed as it goes, and the run ends when the script called `figma.closePlugin()` or went quiet,
// so everything one launch did is a single undo step.

import type { DesignApi } from '../design';
import type { SdkEnv } from '../design';
import type { UiNode } from '../../surface';
import type { NodeOperation } from '../../api/types';
import { DocumentMirror, type MirrorSnapshot } from './mirror';
import { FIGMA_MIXED, FigmaNode, guardNode, type FigmaNodeHost } from './nodes';
import { FigmaCompatError, UNSUPPORTED_FIGMA_MEMBERS, unsupportedMessage } from './table';

const IDLE_MS = 60;
const SELECTION_EVENT = 'selectionchange';
const SUPPORTED_EVENTS = [SELECTION_EVENT, 'close'];

type NodeFactory = Extract<NodeOperation, { op: 'create' }>['type'];

export interface FigmaCompat {
	/** The `figma` global. */
	figma: object;
	/** Open the run and load the snapshot; the plugin's module runs after it. */
	start(): Promise<void>;
	/** The module finished loading: end the run once the plugin stopped changing things. */
	finish(): Promise<void>;
	/**
	 * A command of the plugin ran. The first one is the launch that loaded the module; later ones
	 * run the script again, as launching a Figma plugin twice does. `reload` evaluates the module.
	 */
	launchFromCommand(reload: () => Promise<void>): Promise<void>;
}

export interface NotifyOptions {
	timeout?: number;
	error?: boolean;
}

interface Listener {
	type: string;
	callback: () => void;
	handler: (payload: unknown) => void;
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function guardFigma(target: object): object {
	return new Proxy(target, {
		get(object, property, receiver) {
			if (typeof property === 'string' && Object.hasOwn(UNSUPPORTED_FIGMA_MEMBERS, property)) {
				throw new FigmaCompatError(
					unsupportedMessage(`figma.${property}`, UNSUPPORTED_FIGMA_MEMBERS[property])
				);
			}
			return Reflect.get(object, property, receiver);
		}
	});
}

export function createFigmaCompat(env: SdkEnv, design: DesignApi): FigmaCompat {
	const mirror = new DocumentMirror({
		apply: (operations) => env.call('document.apply', { operations }),
		call: (method, params) => env.call(method, params),
		onError: (error) => env.reportError(error)
	});
	const wrappers = new Map<string, FigmaNode>();
	const host: FigmaNodeHost = {
		mirror,
		pluginId: env.pluginId,
		wrap: (id) => wrap(id)
	};
	function wrap(id: string): FigmaNode {
		mirror.requireNode(id);
		let wrapper = wrappers.get(id);
		if (wrapper === undefined) {
			wrapper = guardNode(new FigmaNode(host, id));
			wrappers.set(id, wrapper);
		}
		return wrapper;
	}

	let runOpen = false;
	let closed = false;
	let firstLaunchPending = true;
	const listeners = new Set<Listener>();
	const emitClose = (): void => {
		for (const listener of listeners) {
			if (listener.type === 'close') listener.callback();
		}
	};

	const endRun = async (): Promise<void> => {
		if (!runOpen) return;
		runOpen = false;
		await mirror.flush();
		await env.call('figma.endRun');
	};

	const create = (type: NodeFactory, props: Record<string, unknown> = {}): FigmaNode => {
		const node = mirror.create(type, mirror.currentPageId, props);
		return wrap(node.id);
	};

	const requireNodes = (nodes: readonly FigmaNode[], what: string): void => {
		if (!Array.isArray(nodes) || nodes.length === 0) {
			throw new FigmaCompatError(`${what} needs at least one node`);
		}
	};

	const group = (nodes: readonly FigmaNode[], parent: FigmaNode, index?: number): FigmaNode => {
		requireNodes(nodes, 'group');
		const bounds = nodes.map((node) => ({
			x: node.x,
			y: node.y,
			right: node.x + node.width,
			bottom: node.y + node.height
		}));
		const left = Math.min(...bounds.map((box) => box.x));
		const top = Math.min(...bounds.map((box) => box.y));
		const width = Math.max(...bounds.map((box) => box.right)) - left;
		const height = Math.max(...bounds.map((box) => box.bottom)) - top;
		const offsets = nodes.map((node) => ({ node, x: node.x - left, y: node.y - top }));
		const created = mirror.create(
			'GROUP',
			parent.id,
			{ name: 'Group', x: left, y: top, width, height },
			index
		);
		for (const offset of offsets) {
			mirror.move(offset.node.id, created.id);
			mirror.update(offset.node.id, { x: offset.x, y: offset.y });
		}
		return wrap(created.id);
	};

	const ungroup = (node: FigmaNode): FigmaNode[] => {
		const parent = node.parent;
		if (parent === null || node.children === undefined) {
			throw new FigmaCompatError('ungroup needs a group or frame inside a page or frame');
		}
		const position = mirror.childIds(parent.id).indexOf(node.id);
		const children = [...node.children];
		const offsets = children.map((child) => ({ child, x: child.x + node.x, y: child.y + node.y }));
		offsets.forEach((offset, order) => {
			mirror.move(offset.child.id, parent.id, position + order);
			mirror.update(offset.child.id, { x: offset.x, y: offset.y });
		});
		mirror.remove(node.id);
		return children;
	};

	const notify = (message: string, options: NotifyOptions = {}): { cancel(): void } => {
		env
			.call('figma.notify', {
				message: String(message),
				error: options.error === true,
				timeout: options.timeout
			})
			.catch((error: unknown) => env.reportError(error));
		return { cancel: () => {} };
	};

	const showUI = (
		content: unknown,
		options: { title?: string; width?: number; height?: number } = {}
	): void => {
		if (typeof content === 'string') {
			throw new FigmaCompatError(
				unsupportedMessage(
					'figma.showUI with an HTML string',
					'plugin UI is a declarative surface tree, not an HTML iframe; pass the tree instead'
				)
			);
		}
		const surface = `${env.pluginId}.figma-ui`;
		const title = options.title === undefined ? 'Plugin' : options.title;
		(async () => {
			await design.ui.set(surface, content as UiNode);
			await design.ui.showModal(surface, {
				title,
				width: options.width,
				height: options.height
			});
		})().catch((error: unknown) => env.reportError(error));
	};

	const addListener = (type: string, callback: () => void): Listener => {
		if (!SUPPORTED_EVENTS.includes(type)) {
			throw new FigmaCompatError(
				unsupportedMessage(`figma.on("${type}")`, 'only selectionchange and close are delivered')
			);
		}
		const handler = (payload: unknown): void => {
			if (type === SELECTION_EVENT) mirror.adoptSelection(readIds(payload));
			callback();
		};
		const listener: Listener = { type, callback, handler };
		listeners.add(listener);
		if (type === SELECTION_EVENT) design.on(SELECTION_EVENT, handler);
		return listener;
	};

	const removeListener = (type: string, callback: () => void): void => {
		for (const listener of listeners) {
			if (listener.type !== type || listener.callback !== callback) continue;
			listeners.delete(listener);
			if (type === SELECTION_EVENT) design.off(SELECTION_EVENT, listener.handler);
		}
	};

	const page = (): FigmaNode => wrap(mirror.currentPageId);

	/** Wait until the plugin stopped changing things and everything it changed was sent. */
	const settle = async (): Promise<void> => {
		let seen = -1;
		while (seen !== mirror.activity) {
			seen = mirror.activity;
			await sleep(IDLE_MS);
			await mirror.flush();
		}
	};

	const figma = {
		apiVersion: '1.0.0',
		command: '',
		editorType: 'figma',
		mixed: FIGMA_MIXED,
		get root() {
			return {
				id: '0:0',
				type: 'DOCUMENT',
				name: mirror.documentName,
				get children() {
					return mirror.pages.map((id) => wrap(id));
				}
			};
		},
		get currentPage(): FigmaNode {
			return page();
		},
		set currentPage(_page: FigmaNode) {
			throw new FigmaCompatError(
				unsupportedMessage('setting figma.currentPage', 'a plugin cannot switch pages yet')
			);
		},
		viewport: {
			get zoom(): number {
				return mirror.zoom;
			},
			scrollAndZoomIntoView(nodes: readonly FigmaNode[]): void {
				const ids = nodes.map((node) => node.id);
				mirror
					.flush()
					.then(() => design.viewport.scrollAndZoomIntoView(ids))
					.catch((error: unknown) => env.reportError(error));
			}
		},
		createRectangle: () => create('RECTANGLE'),
		createEllipse: () => create('ELLIPSE'),
		createText: () => create('TEXT'),
		createFrame: () => create('FRAME'),
		createLine: () => create('LINE'),
		createPolygon: () => create('POLYGON'),
		createStar: () => create('STAR'),
		createComponent: () => create('COMPONENT'),
		createSection: () => create('SECTION'),
		group: (nodes: readonly FigmaNode[], parent: FigmaNode, index?: number) =>
			group(nodes, parent, index),
		ungroup,
		getNodeById: (id: string): FigmaNode | null => {
			if (!mirror.has(id)) return null;
			return wrap(id);
		},
		getNodeByIdAsync: (id: string): Promise<FigmaNode | null> => {
			if (!mirror.has(id)) return Promise.resolve(null);
			return Promise.resolve(wrap(id));
		},
		loadFontAsync: (): Promise<void> => Promise.resolve(),
		notify,
		showUI,
		closePlugin: (message?: string): void => {
			if (closed) return;
			closed = true;
			if (message !== undefined) notify(message);
			emitClose();
			endRun().catch((error: unknown) => env.reportError(error));
		},
		on: (type: string, callback: () => void): void => {
			addListener(type, callback);
		},
		once: (type: string, callback: () => void): void => {
			const wrapper = (): void => {
				removeListener(type, wrapper);
				callback();
			};
			addListener(type, wrapper);
		},
		off: removeListener,
		clientStorage: {
			getAsync: (key: string) => design.storage.clientStorage.get(key),
			setAsync: (key: string, value: unknown) => design.storage.clientStorage.set(key, value),
			deleteAsync: (key: string) => design.storage.clientStorage.delete(key),
			keysAsync: () => design.storage.clientStorage.keys()
		},
		commitUndo: (): void => {
			mirror
				.flush()
				.then(() => design.commitUndo())
				.catch((error: unknown) => env.reportError(error));
		}
	};

	return {
		figma: guardFigma(figma),
		async start() {
			await env.call('figma.beginRun');
			runOpen = true;
			mirror.load(await env.call<MirrorSnapshot>('figma.snapshot'));
		},
		async launchFromCommand(reload) {
			if (firstLaunchPending) {
				firstLaunchPending = false;
				return;
			}
			closed = false;
			for (const listener of listeners) removeListener(listener.type, listener.callback);
			mirror.load(await env.call<MirrorSnapshot>('figma.snapshot'));
			await reload();
			await settle();
		},
		async finish() {
			await settle();
			await endRun();
		}
	};
}

function readIds(payload: unknown): string[] {
	if (typeof payload !== 'object' || payload === null) return [];
	const ids: unknown = Reflect.get(payload, 'ids');
	if (!Array.isArray(ids)) return [];
	return ids.filter((id): id is string => typeof id === 'string');
}
