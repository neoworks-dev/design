import type { DocumentReader, Node, NodeId, VariableResolver } from '../document';
import type { SceneChange, SceneListener, SceneSource } from '../renderer/sceneSource';
import type { DocumentService } from './document';
import type { VariablesService } from './variables';

/**
 * The renderer's view of the live document: the current page of `ctx.document`, with every node
 * passed through the variable resolver so the renderer never sees a raw bound property.
 */
interface Resolution {
	reader: DocumentReader;
	resolver: VariableResolver;
}

export class DocumentSceneSource implements SceneSource {
	private readonly listeners = new Set<SceneListener>();
	private resolution: Resolution | null = null;

	constructor(
		private readonly document: DocumentService,
		private readonly variables: VariablesService
	) {}

	currentPageId(): NodeId | null {
		if (this.document.pages().length === 0) return null;
		return this.document.currentPageId;
	}

	getNode(id: NodeId): Node | undefined {
		return this.current().reader.getNode(id);
	}

	children(id: NodeId | null): readonly NodeId[] {
		return this.current().reader.children(id);
	}

	resolve<T extends Node>(node: T): T {
		return sameKind(node, this.current().resolver.resolvedNode(node.id));
	}

	subscribe(listener: SceneListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	notify(change: SceneChange): void {
		this.resolution = null;
		for (const listener of this.listeners) listener(change);
	}

	get listenerCount(): number {
		return this.listeners.size;
	}

	// A frame reads every visible node; going through the services for each would cost several
	// kernel proxy hops per node, so the plain reader and resolver are fetched once per change
	// (every change, replace and page switch arrives through `notify`).
	private current(): Resolution {
		if (this.resolution !== null) return this.resolution;
		this.resolution = {
			reader: this.document.reader,
			resolver: this.variables.currentResolver()
		};
		return this.resolution;
	}
}

/** The resolver keeps a node's type and only substitutes bound values; anything else is a bug. */
function sameKind<T extends Node>(original: T, resolved: Node): T {
	if (resolved.type !== original.type) return original;
	return resolved as T;
}
