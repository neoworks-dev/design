// Which layers "Rename layers with AI" may touch (#149), and the prompt for them. Pure: it reads
// nodes through a small source, so it is tested without a kernel.
//
// A layer is a candidate when it still has the name the app gave it ("Frame", "Rectangle 12").
// Hidden and locked layers, layers inside component instances, vectors and pages are skipped, and
// so is everything below a skipped container: the user did not ask for those to change.

import { plainText, type Node, type NodeId, type NodeType } from '../document';

export interface RenameSource {
	get(id: NodeId): Node | undefined;
	children(id: NodeId | null): readonly NodeId[];
}

/** Types the rename never renames (vector artwork is named by hand or by its source). */
const SKIPPED_TYPES: readonly NodeType[] = ['PAGE', 'VECTOR', 'BOOLEAN_OPERATION', 'SLICE'];

export const MAX_RENAME_CANDIDATES = 120;
export const MAX_LAYER_NAME_LENGTH = 60;

/** The name `createNode` gives a type: "Frame", "Component set". */
export function defaultNameOf(type: NodeType): string {
	return type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');
}

/** True for the default name of the node's type, with or without a number ("Frame 12"). */
export function hasDefaultName(node: Node): boolean {
	const base = defaultNameOf(node.type).toLowerCase();
	const name = node.name.trim().toLowerCase();
	if (name === base) return true;
	return new RegExp(`^${base} \\d+$`).test(name);
}

export interface RenameCandidate {
	id: NodeId;
	type: NodeType;
	width: number;
	height: number;
	parentName: string;
	/** Characters of a text layer, shortened. */
	text: string;
	/** Names of the children, for containers. */
	childNames: string[];
}

function isSkipped(node: Node): boolean {
	if (SKIPPED_TYPES.includes(node.type)) return true;
	if (node.type === 'PAGE') return true;
	if (!node.visible || node.locked) return true;
	return node.componentRef !== undefined;
}

function candidateOf(source: RenameSource, node: Node): RenameCandidate {
	if (node.type === 'PAGE') throw new Error('a page is not a candidate');
	let parentName = '';
	if (node.parentId !== null) parentName = source.get(node.parentId)?.name ?? '';
	let text = '';
	if (node.type === 'TEXT') text = plainText(node.paragraphs).slice(0, 80);
	const childNames: string[] = [];
	for (const childId of source.children(node.id).slice(0, 8)) {
		const child = source.get(childId);
		if (child !== undefined) childNames.push(child.name);
	}
	return {
		id: node.id,
		type: node.type,
		width: Math.round(node.width),
		height: Math.round(node.height),
		parentName,
		text,
		childNames
	};
}

/**
 * The default-named layers at or below `rootIds`, in tree order, at most `limit`. A skipped
 * layer hides its whole subtree.
 */
export function collectRenameCandidates(
	source: RenameSource,
	rootIds: readonly NodeId[],
	limit: number = MAX_RENAME_CANDIDATES
): RenameCandidate[] {
	const found: RenameCandidate[] = [];
	const visit = (id: NodeId): void => {
		if (found.length >= limit) return;
		const node = source.get(id);
		if (node === undefined || isSkipped(node)) return;
		if (hasDefaultName(node)) found.push(candidateOf(source, node));
		for (const childId of source.children(id)) visit(childId);
	};
	for (const id of rootIds) visit(id);
	return found;
}

function describeCandidate(candidate: RenameCandidate): string {
	const parts = [
		candidate.id,
		candidate.type,
		`${candidate.width}x${candidate.height}`,
		`in "${candidate.parentName}"`
	];
	if (candidate.text !== '') parts.push(`text "${candidate.text.replaceAll('\n', ' ')}"`);
	if (candidate.childNames.length > 0) parts.push(`contains ${candidate.childNames.join(', ')}`);
	return `- ${parts.join(' | ')}`;
}

/** The prompt of a rename run. The first line is the task tag the scripted QA agent keys on. */
export function renamePrompt(candidates: readonly RenameCandidate[]): string {
	return [
		'Task: rename-layers',
		'Give each layer below a short, descriptive name from its content, its position and its',
		`siblings (Title Case, at most 3 words, ${MAX_LAYER_NAME_LENGTH} characters). Call the`,
		'rename_layers tool once with every layer. Do not change anything else.',
		'Layers (id | type | size | parent | content):',
		...candidates.map(describeCandidate)
	].join('\n');
}
