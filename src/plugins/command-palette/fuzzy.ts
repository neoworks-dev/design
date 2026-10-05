// Fuzzy matching for the command palette: the query's characters must appear in the text in
// order (case-insensitive). Higher scores are better matches. Pure.

export interface FuzzyMatch {
	score: number;
	/** Positions in the text of the matched characters, for highlighting. */
	indices: number[];
}

const CONSECUTIVE_BONUS = 8;
const WORD_START_BONUS = 10;
const PREFIX_BONUS = 12;
const GAP_PENALTY = 1;

function isWordStart(text: string, index: number): boolean {
	if (index === 0) return true;
	return /[\s\-_:./]/.test(text[index - 1]);
}

/** Null when `query` is not a subsequence of `text`; an empty query matches everything. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
	const needle = query.trim().toLowerCase();
	if (needle === '') return { score: 0, indices: [] };
	const haystack = text.toLowerCase();
	const indices: number[] = [];
	let score = 0;
	let position = 0;
	for (const character of needle) {
		const found = haystack.indexOf(character, position);
		if (found < 0) return null;
		score += scoreCharacter(text, found, indices[indices.length - 1], position);
		indices.push(found);
		position = found + 1;
	}
	if (indices[0] === 0) score += PREFIX_BONUS;
	score -= text.length * 0.1;
	return { score, indices };
}

function scoreCharacter(
	text: string,
	index: number,
	previousIndex: number | undefined,
	searchStart: number
): number {
	let score = 1;
	if (isWordStart(text, index)) score += WORD_START_BONUS;
	if (previousIndex !== undefined && index === previousIndex + 1) score += CONSECUTIVE_BONUS;
	score -= (index - searchStart) * GAP_PENALTY;
	return score;
}

export interface Ranked<Item> {
	item: Item;
	match: FuzzyMatch;
}

/** Items whose title matches, best first; equal scores keep their input order. */
export function rank<Item>(
	items: readonly Item[],
	query: string,
	titleOf: (item: Item) => string
): Ranked<Item>[] {
	const ranked: Ranked<Item>[] = [];
	for (const item of items) {
		const match = fuzzyMatch(query, titleOf(item));
		if (match) ranked.push({ item, match });
	}
	if (query.trim() === '') return ranked;
	return ranked
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => b.entry.match.score - a.entry.match.score || a.index - b.index)
		.map(({ entry }) => entry);
}
