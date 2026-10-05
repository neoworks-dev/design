// A running prototype: the player state (lib/prototype/machine.ts) as reactive state, plus the
// entry points the view calls (fire a trigger on a node, go back, restart, step between frames).
// Not a Service, so runes are fine; the `prototypePlayer` service creates these.

import type { DocumentReader, NodeId } from '../document';
import type { RenderedFrame } from './frameRender';
import {
	initialState,
	reactionsListeningTo,
	step,
	stepAll,
	type PlayerState,
	type ScreenChange,
	type StepResult
} from './machine';
import type { TriggerKind } from './model';

export interface SessionEnvironment {
	reader(): DocumentReader;
	/** The page's top-level frames in order. */
	screenIds(): NodeId[];
	renderFrame(frameId: NodeId): Promise<RenderedFrame>;
	openUrl(url: string, openInNewTab: boolean): void;
	/** Frees what `renderFrame` allocated. */
	release(frame: RenderedFrame): void;
}

export interface PlayedChange {
	serial: number;
	change: ScreenChange;
}

export interface ScrollRequest {
	serial: number;
	nodeId: NodeId;
}

export class PrototypeSession {
	state = $state.raw<PlayerState>(initialState(''));
	/** The latest screen change; the view animates it once per serial. */
	lastChange = $state.raw<PlayedChange | null>(null);
	scrollRequest = $state.raw<ScrollRequest | null>(null);

	private serial = 0;
	private frames: Record<NodeId, Promise<RenderedFrame>> = {};

	constructor(
		private readonly environment: SessionEnvironment,
		readonly startFrame: NodeId
	) {
		this.state = initialState(startFrame);
	}

	get current(): NodeId {
		return this.state.current;
	}

	get overlays(): readonly NodeId[] {
		return this.state.overlays;
	}

	frame(frameId: NodeId): Promise<RenderedFrame> {
		const cached = this.frames[frameId];
		if (cached !== undefined) return cached;
		const rendered = this.environment.renderFrame(frameId);
		this.frames[frameId] = rendered;
		return rendered;
	}

	/** Run what the reactions of `nodeId` listening for `kind` say. Returns whether any did. */
	fire(nodeId: NodeId, kind: TriggerKind, keyCode?: number): boolean {
		const reader = this.environment.reader();
		const fired = reactionsListeningTo(reader, nodeId, kind, keyCode);
		if (fired.length === 0) return false;
		for (const { reaction } of fired) {
			this.apply(stepAll(reader, this.state, reaction.actions));
		}
		return true;
	}

	back(): void {
		this.apply(step(this.environment.reader(), this.state, { type: 'BACK' }));
	}

	restart(): void {
		this.state = initialState(this.startFrame);
		this.scrollRequest = null;
		this.serial += 1;
		this.lastChange = {
			serial: this.serial,
			change: { kind: 'screen', from: null, to: this.startFrame, transition: undefined }
		};
	}

	closeOverlay(): void {
		this.apply(step(this.environment.reader(), this.state, { type: 'CLOSE' }));
	}

	/** Left/Right arrows: the neighbouring top-level frame, whether or not a connection leads there. */
	stepFrame(offset: 1 | -1): void {
		const ids = this.environment.screenIds();
		const index = ids.indexOf(this.state.current);
		const target = ids[index + offset];
		if (index < 0 || target === undefined) return;
		this.apply(
			step(this.environment.reader(), this.state, {
				type: 'NODE',
				destinationId: target,
				navigation: 'NAVIGATE'
			})
		);
	}

	dispose(): void {
		for (const rendered of Object.values(this.frames)) {
			void rendered.then((frame) => this.environment.release(frame));
		}
		this.frames = {};
	}

	private apply(result: StepResult): void {
		this.state = result.state;
		if (result.change !== null) {
			this.serial += 1;
			this.lastChange = { serial: this.serial, change: result.change };
		}
		if (result.scrollTo !== null) {
			this.serial += 1;
			this.scrollRequest = { serial: this.serial, nodeId: result.scrollTo };
		}
		if (result.url !== null) this.environment.openUrl(result.url.url, result.url.openInNewTab);
	}
}
