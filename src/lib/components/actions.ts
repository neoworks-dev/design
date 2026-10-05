// What the component commands do, as functions of the plugin's `ctx`: each applies one change
// list (one undo step) and then fixes the selection. Always call with the plugin's own `ctx`.

import type { Context } from '@neoworks/extension-system';
import {
	instanceOf,
	planCreateInstance,
	planDetach,
	planPushOverrides,
	planResetGroups,
	planResetOverrides,
	planRestoreMain,
	type Change,
	type NodeId,
	type TouchedGroup
} from '../document';
import { applyEdit } from '../editing/contribute';
import { planCreateComponents } from '../editing/componentEdit';

export function createComponent(ctx: Context): void {
	const plan = planCreateComponents(ctx.document.reader, ctx.selection.ids);
	if (plan === null) return;
	const label = plan.componentIds.length === 1 ? 'Create component' : 'Create components';
	if (!applyEdit(ctx, plan.changes, label)) return;
	ctx.selection.select(plan.componentIds);
}

export function detachInstances(ctx: Context): void {
	const plan = planDetach(ctx.document.reader, ctx.selection.ids);
	if (!applyEdit(ctx, plan.changes, 'Detach instance')) return;
	ctx.selection.select([...plan.frameIds.values()]);
}

/** Main components the selection stands for: selected mains, and the mains of selected instances. */
function mainIdsOfSelection(ctx: Context): NodeId[] {
	const mains = new Set<NodeId>();
	for (const id of ctx.selection.ids) {
		const node = ctx.document.get(id);
		if (node === undefined) continue;
		if (node.type === 'COMPONENT') {
			mains.add(node.id);
			continue;
		}
		const main = ctx.componentSync.mainOf(id);
		if (main !== undefined) mains.add(main.id);
	}
	return [...mains];
}

export function createInstances(ctx: Context): void {
	const mains = mainIdsOfSelection(ctx);
	const changes: Change[] = [];
	const created: NodeId[] = [];
	for (const mainId of mains) {
		const plan = planCreateInstance(ctx.document.reader, mainId);
		changes.push(...plan.changes);
		created.push(plan.rootId);
	}
	if (!applyEdit(ctx, changes, 'Create instance')) return;
	ctx.selection.select(created);
}

/** Select the main component of the selected instance, switching page when it is on another. */
export function goToMain(ctx: Context): void {
	const [id] = ctx.selection.ids;
	if (id === undefined) return;
	const main = ctx.componentSync.mainOf(id);
	if (main === undefined) return;
	const page = ctx.document.pageOf(main.id);
	if (page.id !== ctx.document.currentPageId) ctx.document.setCurrentPage(page.id);
	ctx.selection.select([main.id]);
	ctx.viewport.zoomToSelection([main.id]);
}

/** Selected ids that are, or are inside, an instance. */
function instanceIds(ctx: Context): NodeId[] {
	const reader = ctx.document.reader;
	return ctx.selection.ids.filter((id) => instanceOf(reader, id) !== undefined);
}

export function resetOverrides(ctx: Context, ids: readonly NodeId[] = ctx.selection.ids): void {
	applyEdit(ctx, planResetOverrides(ctx.document.reader, ids), 'Reset overrides');
}

/** Reset some groups on the selected layers only. */
export function resetGroups(ctx: Context, groups: readonly TouchedGroup[]): void {
	const changes = planResetGroups(ctx.document.reader, ctx.selection.ids, groups);
	applyEdit(ctx, changes, 'Reset override');
}

/** Reset every override of the instances the selection is in. */
export function resetAllOverrides(ctx: Context): void {
	const roots = instanceIds(ctx).map((id) => instanceOf(ctx.document.reader, id)?.id);
	const unique = [...new Set(roots)].filter((id): id is NodeId => id !== undefined);
	resetOverrides(ctx, unique);
}

export function pushOverrides(ctx: Context, ids: readonly NodeId[] = ctx.selection.ids): void {
	applyEdit(ctx, planPushOverrides(ctx.document.reader, ids), 'Push overrides to main component');
}

export function restoreMainComponent(ctx: Context): void {
	const changes: Change[] = [];
	const restored: NodeId[] = [];
	const seen = new Set<NodeId>();
	for (const id of ctx.selection.ids) {
		const instance = instanceOf(ctx.document.reader, id);
		if (instance === undefined || instance.type !== 'INSTANCE') continue;
		if (ctx.document.has(instance.mainComponentId) || seen.has(instance.mainComponentId)) continue;
		seen.add(instance.mainComponentId);
		const plan = planRestoreMain(ctx.document.reader, instance.id);
		changes.push(...plan.changes);
		restored.push(plan.rootId);
	}
	if (!applyEdit(ctx, changes, 'Restore main component')) return;
	ctx.selection.select(restored);
}
