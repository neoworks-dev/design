// The `prototypePlayer` service: creates running prototypes (sessions) from the document. A
// session interprets the interactions (lib/prototype/machine.ts) and renders frames through the
// headless renderer, so the player shows exactly what the canvas draws. The view that displays a
// session is contributed by the runtime plugin and handed in as `view`.

import { Service, type Context } from '@neoworks/extension-system';
import type { Component } from 'svelte';
import type { NodeId, Rect } from '../document';
import { renderFrame, type RenderedFrame } from '../prototype/frameRender';
import { PrototypeSession, type SessionEnvironment } from '../prototype/session.svelte';
import type { DocumentService } from './document';
import type { HeadlessRendererService } from './headlessRenderer';
import type { PrototypeService } from './prototype';

declare module '@neoworks/extension-system' {
	interface Context {
		prototypePlayer: PrototypePlayerService;
	}
}

/** The part of the `spatial` service the player uses. */
export interface PlayerGeometry {
	absoluteBounds(id: NodeId): Rect;
	renderBounds(id: NodeId): Rect;
}

const ALLOWED_URL_PROTOCOLS = ['http:', 'https:', 'mailto:'];
const EXPORT_SCALE = 2;

export function isAllowedUrl(url: string): boolean {
	try {
		return ALLOWED_URL_PROTOCOLS.includes(new URL(url).protocol);
	} catch {
		return false;
	}
}

export class PrototypePlayerService extends Service {
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly prototyping: PrototypeService,
		private readonly headless: HeadlessRendererService,
		private readonly geometry: PlayerGeometry,
		/** The component that displays a session; takes `{ session }`. */
		// oxlint-disable-next-line typescript/no-explicit-any
		readonly view: Component<any>
	) {
		super(ctx, 'prototypePlayer');
	}

	/**
	 * Where playing starts: the top-level frame holding the selection, else the first flow, else
	 * the first top-level frame. `undefined` when the page has no frames.
	 */
	defaultStart(selectedIds: readonly NodeId[]): NodeId | undefined {
		for (const id of selectedIds) {
			const screenId = this.prototyping.screenOf(id);
			if (screenId !== undefined) return screenId;
		}
		const [flow] = this.prototyping.flows();
		if (flow !== undefined) return flow.nodeId;
		return this.prototyping.screens()[0]?.id;
	}

	createSession(startFrame: NodeId): PrototypeSession {
		return new PrototypeSession(this.environment(), startFrame);
	}

	/** Frame position inside its top-level frame, for scrolling to a node. */
	offsetInFrame(frameId: NodeId, nodeId: NodeId): { x: number; y: number } {
		const frame = this.geometry.absoluteBounds(frameId);
		const node = this.geometry.absoluteBounds(nodeId);
		return { x: node.x - frame.x, y: node.y - frame.y };
	}

	private environment(): SessionEnvironment {
		return {
			reader: () => this.document.reader,
			screenIds: () => this.prototyping.screens().map((screen) => screen.id),
			renderFrame: (frameId) => this.render(frameId),
			openUrl: (url, openInNewTab) => this.openUrl(url, openInNewTab),
			release: (frame) => {
				for (const layer of frame.layers) URL.revokeObjectURL(layer.url);
			}
		};
	}

	private render(frameId: NodeId): Promise<RenderedFrame> {
		return renderFrame(
			{
				reader: this.document.reader,
				boundsOf: (id) => this.geometry.absoluteBounds(id),
				renderBoundsOf: (id) => this.geometry.renderBounds(id),
				imageUrl: (id, useAbsoluteBounds) => this.imageUrl(id, useAbsoluteBounds)
			},
			frameId
		);
	}

	private async imageUrl(id: NodeId, useAbsoluteBounds: boolean): Promise<string> {
		const image = await this.headless.exportNode(id, { scale: EXPORT_SCALE, useAbsoluteBounds });
		const blob = new Blob([new Uint8Array(image.bytes)], { type: image.mimeType });
		return URL.createObjectURL(blob);
	}

	private openUrl(url: string, openInNewTab: boolean): void {
		if (!isAllowedUrl(url)) return;
		let target = '_self';
		if (openInNewTab) target = '_blank';
		window.open(url, target, 'noopener,noreferrer');
	}
}
