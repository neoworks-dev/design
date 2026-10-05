// The `presentation` service: running the prototype in a view of its own. `present` takes over
// the window (and the screen where the platform allows), `preview` plays inside the canvas area;
// both play the same session from `prototypePlayer`. At most one is open; closing disposes the
// session and its rendered pictures.

import { Service, type Context } from '@neoworks/extension-system';
import { devicePreset, type ScaleMode } from '../prototype/model';
import type { PrototypeSession } from '../prototype/session.svelte';
import type { DocumentService } from './document';
import type { PrototypePlayerService } from './prototypePlayer';
import type { PresentationMode, PresentationState } from './presentationState.svelte';
import type { PrototypeService } from './prototype';
import type { SelectionService } from './selection';

declare module '@neoworks/extension-system' {
	interface Context {
		presentation: PresentationService;
	}
}

export class PresentationService extends Service {
	constructor(
		ctx: Context,
		private readonly player: PrototypePlayerService,
		private readonly prototyping: PrototypeService,
		private readonly selection: SelectionService,
		private readonly document: DocumentService,
		readonly state: PresentationState
	) {
		super(ctx, 'presentation');
	}

	// ---------- reads (reactive) ----------

	get isOpen(): boolean {
		return this.state.mode !== null;
	}

	get mode(): PresentationMode | null {
		return this.state.mode;
	}

	get session(): PrototypeSession | null {
		return this.state.session;
	}

	get scaleMode(): ScaleMode {
		return this.state.scaleMode;
	}

	/** The device preset id in effect: the player's choice, else the page's setting. */
	get deviceId(): string {
		if (this.state.device !== null) return this.state.device;
		return this.prototyping.settings().device;
	}

	get deviceName(): string {
		return devicePreset(this.deviceId).name;
	}

	// ---------- actions ----------

	/** Start playing at the selection's frame (or the first flow). Returns false with nothing to play. */
	open(mode: PresentationMode): boolean {
		const start = this.player.defaultStart(this.selection.ids);
		if (start === undefined) return false;
		this.close();
		this.state.session = this.player.createSession(start);
		this.state.mode = mode;
		return true;
	}

	close(): void {
		this.state.session?.dispose();
		this.state.session = null;
		this.state.mode = null;
	}

	restart(): void {
		this.state.session?.restart();
	}

	next(): void {
		this.state.session?.stepFrame(1);
	}

	previous(): void {
		this.state.session?.stepFrame(-1);
	}

	setScaleMode(mode: ScaleMode): void {
		this.state.scaleMode = mode;
	}

	setDevice(device: string): void {
		this.state.device = device;
	}

	/** Frames of the page, for the player bar's position label. */
	frameName(frameId: string): string {
		const node = this.document.get(frameId);
		if (node === undefined) return '';
		return node.name;
	}
}
