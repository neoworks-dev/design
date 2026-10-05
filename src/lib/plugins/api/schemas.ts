// Validation of what a plugin sends to the host API. A plugin is untrusted code: every parameter
// is parsed with a strict schema before a handler sees it, and a bad one is an error naming the
// field, never a half-applied call.

import { z } from 'zod';
import { NODE_TYPES, type NodeType } from '../../document';
import { MAX_OPERATIONS_PER_CALL } from './operations';

const CREATABLE_TYPES = NODE_TYPES.filter((type) => type !== 'PAGE');
const nodeType = z.enum(NODE_TYPES);
const creatableType = z.enum(CREATABLE_TYPES as [NodeType, ...NodeType[]]);
const id = z.string().min(1).max(200);
const props = z.record(z.string(), z.unknown());

const createOperation = z.strictObject({
	op: z.literal('create'),
	type: creatableType,
	/** The id the new node gets; a worker that must hand out ids synchronously (the figma layer) picks it. */
	id: id.optional(),
	ref: z.string().max(100).optional(),
	parentId: id.optional(),
	position: z.number().int().min(0).optional(),
	props: props.optional()
});
const setOperation = z.strictObject({ op: z.literal('set'), id, props });
const deleteOperation = z.strictObject({ op: z.literal('delete'), id });
const moveOperation = z.strictObject({
	op: z.literal('move'),
	id,
	parentId: id,
	position: z.number().int().min(0).optional()
});

export const apiSchemas = {
	nodeId: z.strictObject({ id }),
	children: z.strictObject({ id: id.nullable() }),
	query: z.strictObject({
		type: nodeType.optional(),
		name: z.string().max(200).optional(),
		rootId: id.optional(),
		limit: z.number().int().min(1).max(500).optional()
	}),
	apply: z.strictObject({
		operations: z
			.array(
				z.discriminatedUnion('op', [createOperation, setOperation, deleteOperation, moveOperation])
			)
			.min(1)
			.max(MAX_OPERATIONS_PER_CALL),
		options: z.strictObject({ label: z.string().min(1).max(200).optional() }).optional()
	}),
	ids: z.strictObject({ ids: z.array(id).max(10_000) }),
	protect: z.strictObject({
		ids: z.array(id).min(1).max(10_000),
		reason: z.string().min(1).max(500)
	}),
	command: z.strictObject({
		id: z.string().min(1).max(200),
		title: z.string().min(1).max(200).optional(),
		when: z.string().min(1).max(500).optional()
	}),
	runCommand: z.strictObject({ id: z.string().min(1).max(200), args: z.unknown().optional() }),
	menu: z.strictObject({
		menu: z.string().min(1).max(200),
		id: z.string().min(1).max(200),
		command: z.string().min(1).max(200),
		title: z.string().min(1).max(200).optional(),
		group: z.string().max(100).optional(),
		order: z.number().optional(),
		when: z.string().min(1).max(500).optional()
	}),
	tool: z.strictObject({
		id: z.string().min(1).max(200),
		title: z.string().min(1).max(200),
		shortcut: z.string().min(1).max(50).optional(),
		cursor: z.string().min(1).max(100).optional()
	}),
	aiTool: z.strictObject({
		id: z.string().min(1).max(64),
		description: z.string().min(1).max(4000),
		inputSchema: z.record(z.string(), z.unknown()).optional(),
		write: z.boolean().optional()
	}),
	codegen: z.strictObject({ id: z.string().min(1).max(200), label: z.string().min(1).max(100) }),
	release: z.strictObject({ handle: z.number().int() })
};

export function parseParams<Schema extends z.ZodType>(
	schema: Schema,
	params: unknown
): z.infer<Schema> {
	let input = params;
	if (input === undefined) input = {};
	const parsed = schema.safeParse(input);
	if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
	return parsed.data;
}
