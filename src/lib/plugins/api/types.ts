// The plain-data shapes that cross the host/worker boundary in plugin API v1. Types only: both
// the worker SDK and the host handlers import them, neither pulls the other in.

import type { Node, NodeType } from '../../document/types';

export type PluginNode = Node;

export interface NodeQuery {
	type?: NodeType;
	/** Case-insensitive part of the layer name. */
	name?: string;
	/** Search below this node; default the current page. */
	rootId?: string;
	limit?: number;
}

/** What a plugin may do to the document, the same vocabulary as the AI tools (Figma-like props). */
export type NodeOperation =
	| {
			op: 'create';
			type: NodeType;
			/** A name later operations of the same call can use as `parentId` or `id`. */
			ref?: string;
			parentId?: string;
			position?: number;
			props?: Record<string, unknown>;
	  }
	| { op: 'set'; id: string; props: Record<string, unknown> }
	| { op: 'delete'; id: string }
	| { op: 'move'; id: string; parentId: string; position?: number };

export interface ApplyOptions {
	/** Names the change in the history; defaults to the running command. */
	label?: string;
}

export interface ApplyResult {
	created: { ref?: string; id: string }[];
	changed: string[];
	deleted: string[];
}

export interface ViewportInfo {
	x: number;
	y: number;
	zoom: number;
}

export interface MenuRegistration {
	/** Menu path, for example `app/plugins` or `context/layer`. */
	menu: string;
	id: string;
	command: string;
	title?: string;
	group?: string;
	order?: number;
	when?: string;
}

export interface ToolRegistration {
	id: string;
	title: string;
	shortcut?: string;
	cursor?: string;
}

export interface ToolPointerMessage {
	tool: string;
	phase: 'down' | 'move' | 'up';
	screen: { x: number; y: number };
	world: { x: number; y: number };
	button: number;
	detail: number;
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

export interface ToolKeyMessage {
	tool: string;
	key: string;
	code: string;
	repeat: boolean;
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

export interface AiToolRegistration {
	/** The tool name the model sees; starts with `<plugin id>_`. */
	id: string;
	description: string;
	/** JSON Schema of the arguments. */
	inputSchema?: Record<string, unknown>;
	write?: boolean;
}

export interface CodegenRegistration {
	id: string;
	label: string;
}

export interface CodegenBlockData {
	title: string;
	code: string;
}

export interface CommandRegistration {
	id: string;
	title?: string;
	when?: string;
}

/** A `documentchange` event: Figma-shaped, one entry per created, deleted or changed node. */
export interface DocumentChangeMessage {
	revision: number;
	origin: 'user' | 'plugin' | 'ai' | 'sync';
	label: string;
	changes: unknown[];
}

export interface SelectionChangeMessage {
	ids: string[];
	previousIds: string[];
}

export interface CurrentPageChangeMessage {
	pageId: string;
	previousPageId: string | null;
}
