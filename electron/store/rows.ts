// Mapping between document objects and table rows. One row per node: `id`, `parent_id`, `idx`
// and `type` are columns (the tree is queryable and indexable), `data` is the node JSON minus
// those four. Entities are `id` plus the JSON of the rest; assets use their own columns.

import type { AssetRecord, EntityKind, Node } from '../../src/lib/document/types';

export interface NodeRow {
	id: string;
	parent_id: string | null;
	idx: string;
	type: string;
	data: string;
}

export function nodeToRow(node: Node): NodeRow {
	const { id, parentId, index, type, ...rest } = node;
	return { id, parent_id: parentId, idx: index, type, data: JSON.stringify(rest) };
}

export function rowToNode(row: NodeRow): Node {
	const rest: unknown = JSON.parse(row.data);
	if (typeof rest !== 'object' || rest === null || Array.isArray(rest)) {
		throw new SyntaxError(`node ${row.id} has no JSON object`);
	}
	return {
		id: row.id,
		parentId: row.parent_id,
		index: row.idx,
		type: row.type,
		...rest
	} as Node;
}

export interface JsonEntityRow {
	id: string;
	data: string;
}

export interface AssetRow {
	hash: string;
	mime: string;
	width: number | null;
	height: number | null;
}

/** Table and key column of each entity kind. */
export const ENTITY_TABLES: Record<EntityKind, { table: string; key: string }> = {
	style: { table: 'styles', key: 'id' },
	variable: { table: 'variables', key: 'id' },
	collection: { table: 'variable_collections', key: 'id' },
	asset: { table: 'assets', key: 'hash' }
};

export function entityToJsonRow(entity: { id: string }): JsonEntityRow {
	const { id, ...rest } = entity;
	return { id, data: JSON.stringify(rest) };
}

export function jsonRowToEntity<T extends { id: string }>(row: JsonEntityRow): T {
	const rest: unknown = JSON.parse(row.data);
	if (typeof rest !== 'object' || rest === null || Array.isArray(rest)) {
		throw new SyntaxError(`row ${row.id} has no JSON object`);
	}
	return { id: row.id, ...rest } as T;
}

export function assetToRow(asset: AssetRecord): AssetRow {
	return {
		hash: asset.id,
		mime: asset.mime,
		width: asset.width === undefined ? null : asset.width,
		height: asset.height === undefined ? null : asset.height
	};
}

export function rowToAsset(row: AssetRow): AssetRecord {
	const asset: AssetRecord = { id: row.hash, mime: row.mime };
	if (row.width !== null) asset.width = row.width;
	if (row.height !== null) asset.height = row.height;
	return asset;
}
