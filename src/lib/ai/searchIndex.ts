// A local semantic-ish index over layers, components and styles (#150). Pure and offline.
//
// Spike result (see the proof on the issue): an embedding model would need a download or a
// network call per edit, an LLM ranking needs the whole candidate list in the prompt and a round
// trip per query. The index here is the first stage of both: it tokenises names, text, type and
// the names of the ancestors, folds a small design vocabulary (button/btn/cta, image/img/photo,
// nav/menu...) and ranks with a weighted TF-IDF. It answers instantly and offline, and its top
// candidates are what the AI re-ranking sees (`ai-search`).
//
// The index is lazy (built on the first query) and incremental: `update(ids)` re-reads only the
// changed layers.

import { plainText, type Node, type NodeId } from '../document';

export interface IndexSource {
	get(id: NodeId): Node | undefined;
	/** Every layer id below the pages, in tree order. */
	allIds(): readonly NodeId[];
}

export interface SearchHit {
	id: NodeId;
	name: string;
	type: string;
	/** Names of the ancestors, outermost first, without the page. */
	path: string[];
	score: number;
}

const SYNONYM_GROUPS: string[][] = [
	['button', 'btn', 'cta', 'action'],
	['image', 'img', 'picture', 'photo', 'pic', 'thumbnail', 'avatar'],
	['navigation', 'nav', 'navbar', 'menu', 'sidebar'],
	['heading', 'title', 'headline', 'header', 'h1', 'h2'],
	['text', 'label', 'copy', 'paragraph', 'caption', 'body'],
	['card', 'tile', 'panel'],
	['icon', 'glyph', 'symbol'],
	['input', 'field', 'textbox', 'form'],
	['background', 'bg', 'backdrop', 'fill'],
	['divider', 'separator', 'line', 'rule'],
	['container', 'wrapper', 'frame', 'box', 'section'],
	['logo', 'brand', 'wordmark'],
	['rectangle', 'rect', 'square'],
	['ellipse', 'circle', 'oval', 'round'],
	['footer', 'bottom'],
	['hero', 'banner', 'jumbotron']
];

const FIELD_WEIGHTS = { name: 4, text: 3, type: 1.5, path: 1 } as const;
type Field = keyof typeof FIELD_WEIGHTS;
const FIELDS: readonly Field[] = ['name', 'text', 'type', 'path'];

const synonymsOf = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
	for (const word of group) synonymsOf.set(word, group);
}

/** Lower-case words of `text`; camelCase and digits split, a trailing plural or -ing dropped. */
export function tokenize(text: string): string[] {
	const spaced = text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-zA-Z])(\d)/g, '$1 $2');
	const words = spaced.toLowerCase().split(/[^a-z0-9]+/);
	return words.filter((word) => word !== '').map(stem);
}

function stem(word: string): string {
	if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3);
	if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
	if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
	return word;
}

function expand(token: string): string[] {
	const group = synonymsOf.get(token);
	if (group === undefined) return [token];
	return group.map(stem);
}

interface IndexedDocument {
	id: NodeId;
	fields: Record<Field, Map<string, number>>;
}

function countTokens(tokens: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
	return counts;
}

export class SearchIndex {
	private readonly documents = new Map<NodeId, IndexedDocument>();
	/** In how many documents each token occurs (for the inverse document frequency). */
	private readonly frequency = new Map<string, number>();
	private built = false;

	constructor(private readonly source: IndexSource) {}

	get size(): number {
		return this.documents.size;
	}

	get isBuilt(): boolean {
		return this.built;
	}

	/** Drop everything; the next query rebuilds (a replaced document). */
	reset(): void {
		this.documents.clear();
		this.frequency.clear();
		this.built = false;
	}

	/** Re-read these layers (changed, created or deleted). A no-op until the first query built the index. */
	update(ids: readonly NodeId[]): void {
		if (!this.built) return;
		for (const id of ids) this.reindex(id);
	}

	search(query: string, limit = 20): SearchHit[] {
		this.ensureBuilt();
		const tokens = tokenize(query);
		if (tokens.length === 0) return [];
		const hits: SearchHit[] = [];
		for (const document of this.documents.values()) {
			const score = this.score(document, tokens);
			if (score <= 0) continue;
			const hit = this.hitOf(document.id, score);
			if (hit !== undefined) hits.push(hit);
		}
		hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
		return hits.slice(0, limit);
	}

	// ---------- internals ----------

	private ensureBuilt(): void {
		if (this.built) return;
		for (const id of this.source.allIds()) this.reindex(id);
		this.built = true;
	}

	private reindex(id: NodeId): void {
		const previous = this.documents.get(id);
		if (previous !== undefined) this.forget(previous);
		const node = this.source.get(id);
		if (node === undefined || node.type === 'PAGE') {
			this.documents.delete(id);
			return;
		}
		const document = this.documentOf(node);
		this.documents.set(id, document);
		for (const token of this.tokensOf(document)) {
			this.frequency.set(token, (this.frequency.get(token) ?? 0) + 1);
		}
	}

	private forget(document: IndexedDocument): void {
		for (const token of this.tokensOf(document)) {
			const remaining = (this.frequency.get(token) ?? 0) - 1;
			if (remaining <= 0) this.frequency.delete(token);
			else this.frequency.set(token, remaining);
		}
	}

	private tokensOf(document: IndexedDocument): Set<string> {
		const tokens = new Set<string>();
		for (const field of Object.values(document.fields)) {
			for (const token of field.keys()) tokens.add(token);
		}
		return tokens;
	}

	private documentOf(node: Node): IndexedDocument {
		let text = '';
		if (node.type === 'TEXT') text = plainText(node.paragraphs);
		if (node.type === 'COMPONENT') text = node.description;
		return {
			id: node.id,
			fields: {
				name: countTokens(tokenize(node.name)),
				text: countTokens(tokenize(text)),
				type: countTokens(tokenize(node.type)),
				path: countTokens(this.pathOf(node.id).flatMap((name) => tokenize(name)))
			}
		};
	}

	pathOf(id: NodeId): string[] {
		const names: string[] = [];
		let current = this.source.get(id)?.parentId ?? null;
		while (current !== null) {
			const parent = this.source.get(current);
			if (parent === undefined || parent.type === 'PAGE') break;
			names.unshift(parent.name);
			current = parent.parentId;
		}
		return names;
	}

	private hitOf(id: NodeId, score: number): SearchHit | undefined {
		const node = this.source.get(id);
		if (node === undefined) return undefined;
		return { id, name: node.name, type: node.type, path: this.pathOf(id), score };
	}

	private score(document: IndexedDocument, queryTokens: readonly string[]): number {
		let total = 0;
		let matched = 0;
		for (const token of queryTokens) {
			const tokenScore = this.scoreToken(document, token);
			if (tokenScore > 0) matched += 1;
			total += tokenScore;
		}
		if (matched === 0) return 0;
		// Every query word found is worth more than the sum: "red button" prefers both.
		return total * (1 + matched / queryTokens.length);
	}

	private scoreToken(document: IndexedDocument, token: string): number {
		const variants = expand(token);
		let best = 0;
		for (const field of FIELDS) {
			const counts = document.fields[field];
			for (const variant of variants) {
				const exact = variant === token ? 1 : 0.7;
				const frequency = counts.get(variant);
				if (frequency !== undefined) {
					best = Math.max(
						best,
						FIELD_WEIGHTS[field] * exact * this.idf(variant) * (1 + Math.log(frequency))
					);
					continue;
				}
				for (const known of counts.keys()) {
					if (variant.length >= 3 && known.startsWith(variant)) {
						best = Math.max(best, FIELD_WEIGHTS[field] * 0.5 * exact * this.idf(known));
					}
				}
			}
		}
		return best;
	}

	private idf(token: string): number {
		const documents = Math.max(1, this.documents.size);
		const containing = this.frequency.get(token) ?? 0;
		return Math.log(1 + documents / (1 + containing));
	}
}
