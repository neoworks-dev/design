// The context a prompt carries about the selection (#147): a compact JSON of the selected
// subtrees plus a short summary of the page and of what the document offers (components,
// variables, styles by name). The size is bounded: the node budget is halved until the text fits
// the character budget, so a huge selection degrades to "top levels only" instead of flooding the
// model's context.

import type { Node, NodeId } from '../document';
import { serializeTree, type TreeSource } from './tools/serialize';

export interface ContextBudget {
	/** Longest text of the whole context, in characters. */
	maxChars: number;
	/** Most selected layers described individually; the rest are counted. */
	maxSelectedRoots: number;
	/** Most names listed per kind (components, variables, styles, layers). */
	maxNames: number;
	/** Levels below a selected layer. */
	depth: number;
	/** Most nodes described over the whole selection before the size check. */
	maxNodes: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
	maxChars: 12_000,
	maxSelectedRoots: 20,
	maxNames: 30,
	depth: 4,
	maxNodes: 150
};

/** What building the context needs to read from the document. */
export interface ContextSource extends TreeSource {
	pageSummary(): { id: NodeId; name: string; topLevel: Node[] };
	componentNames(): string[];
	variableNames(): string[];
	styleNames(): string[];
}

export interface AiContextResult {
	text: string;
	/** Selected layers described in the text (not counting their descendants). */
	described: number;
	selectedCount: number;
	/** True when something was cut to stay within the budget. */
	truncated: boolean;
}

function namesLine(label: string, names: string[], limit: number): string | undefined {
	if (names.length === 0) return undefined;
	const shown = names.slice(0, limit).join(', ');
	let more = '';
	if (names.length > limit) more = ` and ${names.length - limit} more`;
	return `${label}: ${shown}${more}`;
}

function summaryLines(source: ContextSource, budget: ContextBudget): string[] {
	const page = source.pageSummary();
	const layers = page.topLevel.map((node) => `${node.type} "${node.name}" (${node.id})`);
	const lines = [`Page "${page.name}" (${page.id}) has ${page.topLevel.length} top-level layers.`];
	const candidates = [
		namesLine('Top-level layers', layers, budget.maxNames),
		namesLine('Components', source.componentNames(), budget.maxNames),
		namesLine('Variables', source.variableNames(), budget.maxNames),
		namesLine('Styles', source.styleNames(), budget.maxNames)
	];
	for (const line of candidates) {
		if (line !== undefined) lines.push(line);
	}
	return lines;
}

function describeSelection(
	source: ContextSource,
	roots: readonly NodeId[],
	budget: ContextBudget,
	headroom: number
): { json: string; truncated: boolean } {
	let nodeBudget = budget.maxNodes;
	let depth = budget.depth;
	for (;;) {
		const perRoot = Math.max(1, Math.floor(nodeBudget / roots.length));
		const trees = roots.map((id) => serializeTree(source, id, { depth, budget: perRoot }));
		const json = JSON.stringify(trees);
		const truncated = nodeBudget < budget.maxNodes || depth < budget.depth;
		if (json.length <= headroom) return { json, truncated };
		if (nodeBudget > roots.length) {
			nodeBudget = Math.max(roots.length, Math.floor(nodeBudget / 2));
			continue;
		}
		if (depth > 0) {
			depth -= 1;
			continue;
		}
		return { json: json.slice(0, headroom), truncated: true };
	}
}

export function buildSelectionContext(
	source: ContextSource,
	selectedIds: readonly NodeId[],
	budget: ContextBudget = DEFAULT_CONTEXT_BUDGET
): AiContextResult {
	const summary = summaryLines(source, budget).join('\n');
	if (selectedIds.length === 0) {
		return {
			text: `${summary}\nNothing is selected.`.slice(0, budget.maxChars),
			described: 0,
			selectedCount: 0,
			truncated: false
		};
	}
	const roots = selectedIds.slice(0, budget.maxSelectedRoots);
	const heading = `Selection (${selectedIds.length} layers):`;
	const omitted = selectedIds.length - roots.length;
	let footer = '';
	if (omitted > 0) footer = `\n${omitted} more selected layers are not shown.`;
	const headroom = Math.max(
		0,
		budget.maxChars - summary.length - heading.length - footer.length - 2
	);
	const selection = describeSelection(source, roots, budget, headroom);
	return {
		text: `${summary}\n${heading}\n${selection.json}${footer}`,
		described: roots.length,
		selectedCount: selectedIds.length,
		truncated: selection.truncated || omitted > 0
	};
}
