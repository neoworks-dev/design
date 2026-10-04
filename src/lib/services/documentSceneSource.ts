import type { Node, NodeId } from '../document';
import type { SceneChange, SceneListener, SceneSource } from '../renderer/sceneSource';
import type { DocumentService } from './document';
import type { VariablesService } from './variables';

/**
 * The renderer's view of the live document: the current page of `ctx.document`, with every node
 * passed through the variable resolver so the renderer never sees a raw bound property.
 */
export class DocumentSceneSource implements SceneSource {
	private readonly listeners = new Set<SceneListener>();

	constructor(
		private readonly document: DocumentService,
		private readonly variables: VariablesService
	) {}

	currentPageId(): NodeId | null {
		if (this.document.pages().length === 0) return null;
		return this.document.currentPageId;
	}

	getNode(id: NodeId): Node | undefined {
		return this.document.get(id);
	}

	children(id: NodeId | null): readonly NodeId[] {
		return this.document.children(id);
	}

	resolve<T extends Node>(node: T): T {
		return sameKind(node, this.variables.resolvedNode(node.id));
	}

	subscribe(listener: SceneListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	notify(change: SceneChange): void {
		for (const listener of this.listeners) listener(change);
	}

	get listenerCount(): number {
		return this.listeners.size;
	}
}

/** The resolver keeps a node's type and only substitutes bound values; anything else is a bug. */
function sameKind<T extends Node>(original: T, resolved: Node): T {
	if (resolved.type !== original.type) return original;
	return resolved as T;
}
