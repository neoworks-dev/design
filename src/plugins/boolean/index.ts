import type { Context } from '@neoworks/extension-system';
import UnionIcon from 'phosphor-svelte/lib/UnionIcon';
import { generateNodeId, type NodeId } from '../../lib/document';
import { applyEdit, contributeCommand, type MenuPlacement } from '../../lib/editing/contribute';
import {
	BOOLEAN_TITLES,
	planBoolean,
	planFlatten,
	planSetOperation,
	type BooleanOperation
} from '../../lib/editing/booleans';
import { booleanResultPath, pathFillRule, pathToCommands } from '../../lib/renderer/booleanOps';
import type { Deletable } from '../../lib/renderer/ownership';
import { commandsToNetwork } from '../../lib/vector/fromCommands';

interface OperationCommand {
	id: string;
	operation: BooleanOperation;
	key: string;
}

const OPERATIONS: OperationCommand[] = [
	{ id: 'union', operation: 'UNION', key: 'U' },
	{ id: 'subtract', operation: 'SUBTRACT', key: 'S' },
	{ id: 'intersect', operation: 'INTERSECT', key: 'I' },
	{ id: 'exclude', operation: 'EXCLUDE', key: 'X' }
];

const BOOLEAN_MENU = 'context/boolean';
const TOOLBAR_BOOLEAN_MENU = 'toolbar/boolean';

function operationMenus(order: number): MenuPlacement[] {
	return [
		{ menu: BOOLEAN_MENU, group: '1', order },
		{ menu: TOOLBAR_BOOLEAN_MENU, group: '1', order }
	];
}

function flattenOperationMenus(order: number): MenuPlacement[] {
	return [{ menu: TOOLBAR_BOOLEAN_MENU, group: '2_flatten', order }];
}

/** The result of a boolean node as a vector network in the node's local space. */
function resultNetwork(ctx: Context, id: NodeId): ReturnType<typeof commandsToNetwork> | null {
	const node = ctx.document.get(id);
	if (!node || node.type !== 'BOOLEAN_OPERATION') return null;
	const kit = ctx.canvaskit.kit;
	const temporaries: Deletable[] = [];
	try {
		const path = booleanResultPath(
			kit,
			{
				getNode: (nodeId) => ctx.document.get(nodeId),
				children: (nodeId) => ctx.document.children(nodeId)
			},
			node,
			(object) => {
				temporaries.push(object);
				return object;
			}
		);
		if (!path) return null;
		return commandsToNetwork(pathToCommands(kit, path), pathFillRule(kit, path));
	} finally {
		while (temporaries.length > 0) temporaries.pop()?.delete();
	}
}

function flatten(ctx: Context, id: NodeId): NodeId | null {
	const network = resultNetwork(ctx, id);
	if (!network) return null;
	const plan = planFlatten(ctx.document.reader, id, network);
	if (!plan) return null;
	applyEdit(ctx, plan.changes, 'Flatten');
	return plan.vectorId;
}

function flattenSelection(ctx: Context): void {
	const flattened: NodeId[] = [];
	const handle = ctx.history.beginGroup({ label: 'Flatten' });
	try {
		for (const id of ctx.selection.ids) {
			const vectorId = flatten(ctx, id);
			if (vectorId !== null) flattened.push(vectorId);
		}
	} finally {
		ctx.history.endGroup(handle);
	}
	if (flattened.length > 0) ctx.selection.select(flattened);
}

/** Wraps the selection in a boolean node; `flattenNow` (Alt) flattens it in the same undo step. */
function combine(ctx: Context, operation: BooleanOperation, flattenNow: boolean): void {
	const selected = ctx.selection.ids;
	const existing = selected.filter((id) => ctx.document.get(id)?.type === 'BOOLEAN_OPERATION');
	if (existing.length === selected.length) {
		applyEdit(ctx, planSetOperation(ctx.document.reader, existing, operation), 'Change boolean');
		return;
	}
	const handle = ctx.history.beginGroup({ label: BOOLEAN_TITLES[operation] });
	try {
		const plan = planBoolean(ctx.document.reader, selected, operation, generateNodeId());
		if (!plan) return;
		applyEdit(ctx, plan.changes, BOOLEAN_TITLES[operation]);
		ctx.selection.select([plan.booleanId]);
		if (flattenNow) flattenSelection(ctx);
	} finally {
		ctx.history.endGroup(handle);
	}
}

// Boolean operations (docs/research/interactions.md section 13): union, subtract, intersect and
// exclude wrap the selection (two or more nodes) in a live BOOLEAN_OPERATION node whose operands
// stay editable; its geometry is derived with Skia PathOps by the renderer. Applied to selected
// boolean nodes the commands change their operation instead. The `...-flatten` commands (the
// Alt variants) and Flatten replace a boolean by a VECTOR node holding its result. Every command
// is one undo step.
export default {
	name: 'boolean',
	inject: ['canvaskit', 'document', 'selection', 'history', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		OPERATIONS.forEach((entry, position) => {
			const title = BOOLEAN_TITLES[entry.operation];
			contributeCommand(ctx, {
				id: `boolean.${entry.id}`,
				title: `Boolean: ${title}`,
				when: 'hasSelection',
				run: () => combine(ctx, entry.operation, false),
				keys: [`Mod+Alt+${entry.key}`],
				menus: operationMenus(position)
			});
			contributeCommand(ctx, {
				id: `boolean.${entry.id}-flatten`,
				title: `Boolean: ${title} and flatten`,
				when: 'hasSelection',
				run: () => combine(ctx, entry.operation, true),
				keys: [`Mod+Alt+Shift+${entry.key}`],
				menus: flattenOperationMenus(position)
			});
		});
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'toolbar',
					item: {
						id: 'boolean',
						title: 'Boolean operation',
						icon: UnionIcon,
						submenu: TOOLBAR_BOOLEAN_MENU,
						order: 50
					}
				}),
			'menu toolbar boolean'
		);
		contributeCommand(ctx, {
			id: 'boolean.flatten',
			title: 'Flatten',
			when: 'hasSelection',
			run: () => flattenSelection(ctx),
			menus: [{ menu: TOOLBAR_BOOLEAN_MENU, group: '3_flatten', order: 10 }]
		});
	}
};
