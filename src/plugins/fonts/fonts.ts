// The renderer's `fonts` service: which faces exist (embedded in the file, installed on the
// system, bundled with the app), how a document's font reference resolves to one of them, and the
// bytes of a face on demand.
//
// It does not talk to CanvasKit. The renderer attaches a `FontSink` (a thin adapter over
// `TypefaceFontProvider.registerFont`) and receives every loaded face's bytes. To draw a text run,
// ask `resolve(ref)` and use `face.family` as the family name the sink registered.
//
// Reactive state lives in `FontsState`; the byte cache below is plain data, not UI state.

import { Service, type Context } from '@neoworks/extension-system';
import { BUNDLED_FACES, FALLBACK_FAMILY, type BundledFace } from '../../lib/fonts/bundled';
import {
	resolveFont,
	sameFace,
	type FontEntry,
	type FontRef,
	type ResolvedFont
} from '../../lib/fonts/resolve';
import { FontsState } from '../../lib/fonts/state.svelte';
import { woffToSfnt } from '../../lib/fonts/woff';

/** Receives the bytes of every face the service loads (CanvasKit's font provider, in practice). */
export interface FontSink {
	/** `bytes` is a TrueType / OpenType file; `family` is the face's resolved family name. */
	registerFont(face: FontEntry, bytes: ArrayBuffer): void;
}

export interface LoadedFont extends ResolvedFont {
	/** The bytes of `face`, as a TrueType / OpenType file. */
	bytes: ArrayBuffer;
}

export interface FontsOptions {
	/** Fetches a bundled font file; defaults to `fetch`. Tests pass a stub. */
	fetchBytes?: (url: string) => Promise<ArrayBuffer>;
}

const BUNDLED_ENTRIES: readonly FontEntry[] = BUNDLED_FACES.map((face) => ({
	family: face.family,
	style: face.style,
	source: 'bundled'
}));
const FALLBACK_ENTRIES = BUNDLED_ENTRIES.filter((face) => face.family === FALLBACK_FAMILY);

async function fetchUrl(url: string): Promise<ArrayBuffer> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
	return response.arrayBuffer();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	return copy;
}

function cacheKey(face: FontEntry): string {
	return `${face.source}\u0000${face.family}\u0000${face.style}`.toLowerCase();
}

function bundledFace(face: FontEntry): BundledFace {
	const found = BUNDLED_FACES.find((candidate) => sameFace(candidate, face));
	if (!found) throw new Error(`not a bundled face: ${face.family} ${face.style}`);
	return found;
}

export class FontsService extends Service {
	private readonly loaded = new Map<string, Promise<ArrayBuffer>>();
	private readonly embeddedBytes = new Map<FontEntry, ArrayBuffer>();
	private readonly sinks = new Set<FontSink>();
	private readonly fetchBytes: (url: string) => Promise<ArrayBuffer>;

	constructor(
		ctx: Context,
		private readonly state: FontsState,
		options: FontsOptions = {}
	) {
		super(ctx, 'fonts');
		this.fetchBytes = options.fetchBytes === undefined ? fetchUrl : options.fetchBytes;
	}

	/** True once the installed fonts were listed; before that, `isMissing` reports nothing missing. */
	get ready(): boolean {
		return this.state.ready;
	}

	/** Every available face: embedded first, then installed, then bundled. */
	faces(): FontEntry[] {
		return [...this.state.embedded, ...this.state.system, ...BUNDLED_ENTRIES];
	}

	/** Family names of everything available, sorted, for pickers. */
	families(): string[] {
		const names = new Set(this.faces().map((face) => face.family));
		return [...names].sort((left, right) => left.localeCompare(right));
	}

	/** (Re)list the installed fonts through main. Failing leaves the previous list in place. */
	async refresh(): Promise<void> {
		const refs = await this.ctx.desktop.listSystemFonts();
		this.state.setSystem(refs);
		this.ctx.emit('fonts/changed');
	}

	/** The face to draw `ref` with, and whether it is a substitute. Never throws. */
	resolve(ref: FontRef): ResolvedFont {
		return resolveFont(ref, this.faces(), FALLBACK_ENTRIES);
	}

	/**
	 * Whether a text run referencing `ref` should show the missing-font flag. False while the
	 * installed fonts are still being listed, so nothing flashes as missing at startup. Reads
	 * reactive state, so a `$derived` over it updates when the list arrives.
	 */
	isMissing(ref: FontRef): boolean {
		if (!this.state.ready) return false;
		return this.resolve(ref).missing;
	}

	/** The distinct references among `refs` that are missing, in first-seen order. */
	missingFonts(refs: Iterable<FontRef>): FontRef[] {
		const missing: FontRef[] = [];
		for (const ref of refs) {
			if (missing.some((seen) => sameFace(seen, ref))) continue;
			if (this.isMissing(ref)) missing.push({ family: ref.family, style: ref.style });
		}
		return missing;
	}

	/** Whether any of `refs` is missing: the `hasMissingFont` flag of a text node. */
	hasMissingFont(refs: Iterable<FontRef>): boolean {
		return this.missingFonts(refs).length > 0;
	}

	/**
	 * Register an embedded face (from the file's `fonts` table). Embedded faces win over installed
	 * ones with the same name. The returned function removes it.
	 */
	embed(ref: FontRef, bytes: ArrayBuffer): () => Promise<void> {
		return this.ctx.effect(() => {
			const remove = this.state.addEmbedded(ref);
			const entry = this.state.embedded.find((face) => sameFace(face, ref));
			if (entry) {
				this.embeddedBytes.set(entry, bytes);
				this.loaded.delete(cacheKey(entry));
			}
			return () => {
				remove();
				if (entry) this.embeddedBytes.delete(entry);
			};
		}, `fonts:embed:${ref.family}:${ref.style}`);
	}

	/**
	 * Load the face `ref` resolves to. Always yields bytes: an unknown or unreadable font falls
	 * back to the bundled one with `missing: true`, it does not throw. Each face is fetched once
	 * and handed to every attached sink.
	 */
	async load(ref: FontRef): Promise<LoadedFont> {
		let resolved = this.resolve(ref);
		try {
			return { ...resolved, bytes: await this.bytesOf(resolved.face) };
		} catch (error) {
			if (resolved.face.source === 'bundled') throw error;
			this.ctx.logger.warn(`font ${resolved.face.family} ${resolved.face.style} unreadable`, error);
			resolved = {
				face: resolveFont(ref, BUNDLED_ENTRIES, FALLBACK_ENTRIES).face,
				missing: true
			};
			return { ...resolved, bytes: await this.bytesOf(resolved.face) };
		}
	}

	/**
	 * Attach a sink for the lifetime of the calling plugin: faces already loaded are replayed to
	 * it, later loads follow. Unmounting the caller detaches it; so does the returned function.
	 */
	attach(sink: FontSink): () => Promise<void> {
		return this.ctx.effect(() => {
			this.sinks.add(sink);
			for (const [key, pending] of this.loaded) {
				void pending.then((bytes) => this.deliverKnown(sink, key, bytes));
			}
			return () => {
				this.sinks.delete(sink);
			};
		}, 'fonts:attach');
	}

	/** Observable state for the standard plugin test. */
	snapshotState(): unknown {
		return {
			ready: this.state.ready,
			system: this.state.system.length,
			embedded: this.state.embedded.length,
			sinks: this.sinks.size
		};
	}

	private deliverKnown(sink: FontSink, key: string, bytes: ArrayBuffer): void {
		const face = this.faces().find((candidate) => cacheKey(candidate) === key);
		if (face && this.sinks.has(sink)) sink.registerFont(face, bytes);
	}

	private bytesOf(face: FontEntry): Promise<ArrayBuffer> {
		const key = cacheKey(face);
		let pending = this.loaded.get(key);
		if (!pending) {
			pending = this.fetchFace(face).then((bytes) => {
				for (const sink of this.sinks) sink.registerFont(face, bytes);
				return bytes;
			});
			this.loaded.set(key, pending);
			pending.catch(() => {
				if (this.loaded.get(key) === pending) this.loaded.delete(key);
			});
		}
		return pending;
	}

	private async fetchFace(face: FontEntry): Promise<ArrayBuffer> {
		if (face.source === 'embedded') {
			const bytes = this.embeddedBytes.get(face);
			if (!bytes) throw new Error(`embedded font vanished: ${face.family} ${face.style}`);
			return bytes;
		}
		if (face.source === 'bundled') {
			const raw = new Uint8Array(await this.fetchBytes(bundledFace(face).url));
			return toArrayBuffer(await woffToSfnt(raw));
		}
		const bytes = await this.ctx.desktop.loadSystemFont({ family: face.family, style: face.style });
		if (bytes === null) throw new Error(`system font not found: ${face.family} ${face.style}`);
		return toArrayBuffer(bytes);
	}
}
