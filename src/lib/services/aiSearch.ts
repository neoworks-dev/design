// The `aiSearch` service (#150): find layers, components and styles by what they are about.
//
// Two stages. The local index (`SearchIndex`: names, text, type, ancestors, a design vocabulary)
// answers every keystroke instantly and offline, and follows the document incrementally. When the
// words are not enough ("sign in" for a layer called "Login"), `askAi` sends the best local
// candidates and a sample of the other layers to the model in a read-only run; the model reports
// the matching ids with the `report_matches` tool and the results are shown first.

import { Service, type Context } from '@neoworks/extension-system';
import { plainText, type Node, type NodeId, type Style } from '../document';
import { SearchIndex, tokenize, type SearchHit } from '../ai/searchIndex';
import { AiConsentRequiredError } from '../ai/types';
import type { AiSearchState } from './aiSearchState.svelte';

/** A search run reads and answers through its own tool, nothing else. */
const SEARCH_TOOLS: readonly string[] = ['read', 'report_matches'];

declare module '@neoworks/extension-system' {
	interface Context {
		aiSearch: AiSearchService;
	}
}

export type SearchResultKind = 'layer' | 'component' | 'style';

export interface SearchResult {
	kind: SearchResultKind;
	id: string;
	title: string;
	subtitle: string;
	score: number;
	/** Put there by the AI, not by the index. */
	fromAi: boolean;
}

export const AI_CANDIDATE_LIMIT = 60;
const LOCAL_CANDIDATES = 25;

/** The parts of the `ai` service the search uses. */
export interface SearchAi {
	readonly available: boolean;
	run(
		prompt: string,
		options?: { scope?: 'read' | 'write'; display?: string; tools?: readonly string[] }
	): { id: string; finished: Promise<unknown> };
}

export interface SearchDocument {
	get(id: NodeId): Node | undefined;
	query(predicate: (node: Node) => boolean): Node[];
	entities(kind: 'style'): Style[];
	pageOf(id: NodeId): Node;
	setCurrentPage(id: NodeId): void;
}

export interface SearchSelection {
	select(ids: NodeId[], mode: 'replace', options: { source: 'canvas' }): void;
}

export interface SearchActions {
	zoomToSelection(): void;
	showStyleInAssets(style: Style): void;
	openChat(): void;
}

function typeLabel(type: string): string {
	return type.toLowerCase().replaceAll('_', ' ');
}

export class AiSearchService extends Service {
	private readonly index: SearchIndex;
	/** Candidates of the run in flight, by run id: the model may only report these. */
	private readonly candidates = new Map<string, Set<string>>();

	constructor(
		ctx: Context,
		private readonly ai: SearchAi,
		private readonly document: SearchDocument,
		private readonly selection: SearchSelection,
		private readonly actions: SearchActions,
		private readonly state: AiSearchState
	) {
		super(ctx, 'aiSearch');
		this.index = new SearchIndex({
			get: (id) => this.document.get(id),
			allIds: () => this.document.query((node) => node.type !== 'PAGE').map((node) => node.id)
		});
	}

	// ---------- reads ----------

	get asking(): boolean {
		return this.state.asking;
	}

	get notice(): string {
		return this.state.notice;
	}

	get canAskAi(): boolean {
		return this.ai.available;
	}

	/** Local results for `query`, with what the AI reported for the same query first. */
	search(query: string, limit = 30): SearchResult[] {
		const local = [...this.layerResults(query, limit), ...this.styleResults(query)];
		local.sort((a, b) => b.score - a.score);
		const fromAi = this.aiResults(query);
		const known = new Set(fromAi.map((result) => `${result.kind}:${result.id}`));
		const rest = local.filter((result) => !known.has(`${result.kind}:${result.id}`));
		return [...fromAi, ...rest].slice(0, limit);
	}

	/** Layers matched by the index (components flagged), best first. */
	layerHits(query: string, limit = 30): SearchHit[] {
		return this.index.search(query, limit);
	}

	// ---------- actions ----------

	/** Select a layer or component and zoom to it; a style is shown in the assets panel. */
	pick(result: SearchResult): void {
		if (result.kind === 'style') {
			const style = this.document.entities('style').find((candidate) => candidate.id === result.id);
			if (style !== undefined) this.actions.showStyleInAssets(style);
			return;
		}
		if (this.document.get(result.id) === undefined) return;
		this.document.setCurrentPage(this.document.pageOf(result.id).id);
		this.selection.select([result.id], 'replace', { source: 'canvas' });
		this.actions.zoomToSelection();
	}

	/** Ask the model to rank candidates for `query`. Resolves when the run ended. */
	async askAi(query: string): Promise<SearchResult[]> {
		const text = query.trim();
		if (text === '' || this.state.asking) return [];
		const candidates = this.candidatesFor(text);
		let run: { id: string; finished: Promise<unknown> };
		try {
			run = this.ai.run(searchPrompt(text, candidates), {
				scope: 'read',
				tools: SEARCH_TOOLS,
				display: `Find: ${text}`
			});
		} catch (error) {
			if (!(error instanceof AiConsentRequiredError)) throw error;
			this.state.notice = 'Allow the AI for this document in the AI panel, then try again.';
			this.actions.openChat();
			return [];
		}
		this.candidates.set(run.id, new Set(candidates.map((candidate) => candidate.id)));
		this.state.asking = true;
		this.state.notice = '';
		this.state.pendingQuery = text;
		try {
			await run.finished;
		} finally {
			this.state.asking = false;
			this.candidates.delete(run.id);
		}
		return this.aiResults(text);
	}

	/** The `report_matches` tool: remember the ids the model picked, best first. */
	reportMatches(runId: string, ids: readonly string[]): string[] {
		const allowed = this.candidates.get(runId);
		if (allowed === undefined) throw new Error('this run was not started to search');
		const accepted = ids.filter((id, position) => allowed.has(id) && ids.indexOf(id) === position);
		this.state.aiQuery = this.state.pendingQuery;
		this.state.aiIds = accepted;
		return accepted;
	}

	// ---------- wired by the plugin ----------

	/** `document/change`: re-read the touched layers. */
	handleChange(ids: readonly NodeId[]): void {
		this.index.update(ids);
	}

	handleDocumentReplace(): void {
		this.index.reset();
		this.state.aiQuery = '';
		this.state.aiIds = [];
	}

	snapshotState(): Record<string, unknown> {
		return { asking: this.state.asking, indexed: this.index.size };
	}

	// ---------- internals ----------

	private layerResults(query: string, limit: number): SearchResult[] {
		return this.index.search(query, limit).map((hit) => this.resultOfHit(hit, false));
	}

	private resultOfHit(hit: SearchHit, fromAi: boolean): SearchResult {
		let kind: SearchResultKind = 'layer';
		if (hit.type === 'COMPONENT' || hit.type === 'COMPONENT_SET') kind = 'component';
		const where = hit.path.join(' / ');
		let subtitle = typeLabel(hit.type);
		if (where !== '') subtitle = `${subtitle} in ${where}`;
		return { kind, id: hit.id, title: hit.name, subtitle, score: hit.score, fromAi };
	}

	private styleResults(query: string): SearchResult[] {
		const tokens = tokenize(query);
		if (tokens.length === 0) return [];
		const results: SearchResult[] = [];
		for (const style of this.document.entities('style')) {
			const words = new Set(tokenize(`${style.name} ${style.type} ${style.description}`));
			const matched = tokens.filter((token) => words.has(token)).length;
			if (matched === 0) continue;
			results.push({
				kind: 'style',
				id: style.id,
				title: style.name,
				subtitle: `${style.type.toLowerCase()} style`,
				score: (matched / tokens.length) * 10,
				fromAi: false
			});
		}
		return results;
	}

	private aiResults(query: string): SearchResult[] {
		if (this.state.aiQuery !== query.trim()) return [];
		const results: SearchResult[] = [];
		for (const id of this.state.aiIds) {
			const node = this.document.get(id);
			if (node === undefined || node.type === 'PAGE') continue;
			const hit: SearchHit = {
				id,
				name: node.name,
				type: node.type,
				path: this.index.pathOf(id),
				score: 100
			};
			results.push(this.resultOfHit(hit, true));
		}
		return results;
	}

	private candidatesFor(query: string): CandidateLine[] {
		const chosen = new Map<string, CandidateLine>();
		for (const hit of this.index.search(query, LOCAL_CANDIDATES)) {
			chosen.set(hit.id, this.lineOf(hit.id));
		}
		const everyone = this.document.query((node) => node.type !== 'PAGE');
		for (const node of everyone) {
			if (chosen.size >= AI_CANDIDATE_LIMIT) break;
			if (!chosen.has(node.id)) chosen.set(node.id, this.lineOf(node.id));
		}
		return [...chosen.values()];
	}

	private lineOf(id: NodeId): CandidateLine {
		const node = this.document.get(id);
		if (node === undefined) return { id, type: '', name: '', text: '' };
		let text = '';
		if (node.type === 'TEXT') text = textOf(node);
		return { id, type: node.type, name: node.name, text };
	}
}

interface CandidateLine {
	id: string;
	type: string;
	name: string;
	text: string;
}

function textOf(node: Node): string {
	if (node.type !== 'TEXT') return '';
	return plainText(node.paragraphs).replaceAll('\n', ' ').slice(0, 80);
}

/** The prompt of a search run. The first line is the task tag the scripted QA agent keys on. */
export function searchPrompt(query: string, candidates: readonly CandidateLine[]): string {
	return [
		'Task: search-layers',
		`Query: ${query}`,
		'Pick the layers, components or styles that best match the query by meaning, not only by',
		'spelling. Call the report_matches tool once with their ids, best first (at most 15).',
		'Candidates (id | type | name | text):',
		...candidates.map((candidate) =>
			`- ${candidate.id} | ${candidate.type} | ${candidate.name} | ${candidate.text}`.trimEnd()
		)
	].join('\n');
}
