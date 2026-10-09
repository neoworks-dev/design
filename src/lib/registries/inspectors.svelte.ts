// Inspectors: property-panel sections that apply to a node type or selection shape (single,
// multi, mixed types, instance, text). A section declares `applies(selection)`; the panel shows
// it only while that holds.
//
// Provided by plugin `core-inspectors` as `ctx.inspectors`:
//
//   ctx.effect(
//   	() =>
//   		ctx.inspectors.register({
//   			id: 'text', tab: 'design', title: 'Text', order: 20,
//   			applies: (selection) => selection.hasText,
//   			component: TextSection
//   		}),
//   	'text inspector'
//   );
//
// An inspector is a panel section (see panels.svelte.ts) whose visibility is the `applies`
// predicate over the live selection, so tabs, ordering and collapse state come from `panels`.
//
// The selection comes through a `SelectionSource`: the plugin connects the `selection` service
// as soon as one is provided; nothing here imports it.
//
// Inside a section, `inspectors.property(read, write)` reads a property across the selection
// (`MIXED` when nodes diverge) and sets it through the `write` callback, which is where the
// section applies a change set (`ctx.document.apply`). The write goes through the one mutation
// path because the section owns the change; this helper only fans the value out to the nodes.

import { Service, type Context } from '@neoworks/extension-system';
import type { Component } from 'svelte';
import type { Node } from '../document';
import {
	MIXED,
	isSameValue,
	readProperty,
	summarizeSelection,
	type InspectorSelection,
	type Mixed
} from '../inspectors/selection';
import type { PanelsService } from './panels.svelte';
import { callerContext } from '../kernel/caller';
import { Registry, type RegistryEntry } from './registry.svelte';

/** Where inspectors read the selected nodes from. `nodes()` must be reactive. */
export interface SelectionSource {
	nodes(): readonly Node[];
}

// Contributed components have arbitrary props, see RegionContribution.
// oxlint-disable-next-line typescript/no-explicit-any
type AnyComponent = Component<any>;

export interface InspectorContribution {
	id: string;
	/** Tab the section stacks in, for example `design`. */
	tab: string;
	title: string;
	order?: number;
	/** Reactive: read while the section list renders, so it may read the selection. */
	applies: (selection: InspectorSelection) => boolean;
	component: AnyComponent;
	/** Header controls shown next to the title, aligned with it. */
	actions?: AnyComponent;
	props?: Record<string, unknown>;
	collapsed?: boolean;
	/** Reactive: the section has nothing to show yet and folds into its title row. */
	empty?: () => boolean;
}

export interface InspectorEntry extends RegistryEntry {
	tab: string;
	title: string;
	applies: (selection: InspectorSelection) => boolean;
}

/** A property of the selection as one value, for a section's controls. */
export interface SelectionProperty<Value> {
	/** Reactive. The shared value, `MIXED`, or `undefined` for an empty selection. */
	readonly value: Value | Mixed | undefined;
	readonly isMixed: boolean;
	/** Hand the new value and the selected nodes to the section's writer. */
	set(value: Value): void;
}

const NO_SELECTION: readonly Node[] = [];

/** Holds the selection source. Not a Service, so runes are fine. */
export class SelectionSourceHolder {
	current = $state.raw<SelectionSource | null>(null);

	// Every section and every property read the selection; deriving it once per document change
	// keeps that from scaling with sections × properties × selected nodes.
	readonly nodes: readonly Node[] = $derived.by(() => {
		const source = this.current;
		if (source === null) return NO_SELECTION;
		return source.nodes();
	});

	#lastSummary: InspectorSelection = summarizeSelection(NO_SELECTION);

	// The same object while the shape stays: a drag changes every selected node on every move,
	// but not which sections apply, so they need not re-evaluate.
	readonly summary: InspectorSelection = $derived.by(() => {
		const next = summarizeSelection(this.nodes);
		if (isSameValue(next, this.#lastSummary)) return this.#lastSummary;
		this.#lastSummary = next;
		return next;
	});
}

declare module '@neoworks/extension-system' {
	interface Context {
		inspectors: InspectorsService;
	}
}

export class InspectorsService extends Service {
	readonly registry = new Registry<InspectorEntry>();
	readonly source = new SelectionSourceHolder();

	/** `panels` is captured from the providing plugin's ctx (see CommandsService). */
	constructor(
		ctx: Context,
		private readonly panels: PanelsService
	) {
		super(ctx, 'inspectors');
	}

	/** Contribute a section that is visible while `applies(selection)` holds. */
	register(inspector: InspectorContribution): () => void {
		const owner = callerContext(this, this.ctx);
		const entry: InspectorEntry = {
			id: inspector.id,
			order: inspector.order,
			tab: inspector.tab,
			title: inspector.title,
			applies: inspector.applies
		};
		const disposeEntry = this.registry.register(entry);
		const disposeSection = this.panels.registerSection({
			tab: inspector.tab,
			id: inspector.id,
			title: inspector.title,
			order: inspector.order,
			component: inspector.component,
			actions: inspector.actions,
			props: inspector.props,
			collapsed: inspector.collapsed,
			empty: inspector.empty,
			owner,
			visible: () => this.appliesTo(entry)
		});
		return () => {
			disposeSection();
			disposeEntry();
		};
	}

	/** Connect the selection. A later source replaces an earlier one; dispose by identity. */
	setSelectionSource(source: SelectionSource): () => void {
		this.source.current = source;
		return () => {
			if (this.source.current === source) this.source.current = null;
		};
	}

	/** Reactive: the selected nodes, empty while no source is connected. */
	nodes(): readonly Node[] {
		return this.source.nodes;
	}

	/** Reactive: the shape of the selection. */
	summary(): InspectorSelection {
		return this.source.summary;
	}

	/** Reactive: ids of the registered inspectors that apply right now. */
	activeIds(): string[] {
		return this.registry
			.list()
			.filter((entry) => this.appliesTo(entry))
			.map((entry) => entry.id);
	}

	/** Bind a property of the selected nodes: reactive reads, writes through `write`. */
	property<Value>(
		read: (node: Node) => Value,
		write: (nodes: readonly Node[], value: Value) => void
	): SelectionProperty<Value> {
		const selected = (): readonly Node[] => this.nodes();
		return {
			get value(): Value | Mixed | undefined {
				return readProperty(selected(), read);
			},
			get isMixed(): boolean {
				return readProperty(selected(), read) === MIXED;
			},
			set: (value) => write(selected(), value)
		};
	}

	snapshotState(): unknown {
		return { source: this.source.current !== null };
	}

	private appliesTo(entry: InspectorEntry): boolean {
		try {
			return entry.applies(this.summary());
		} catch (error) {
			this.ctx.logger.error(error);
			return false;
		}
	}
}
