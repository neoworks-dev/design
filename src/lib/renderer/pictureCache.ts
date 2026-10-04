// Recordings of containers (#45). A page-level container with many descendants is drawn once into
// an SkPicture and replayed on later frames, which costs a fraction of walking its subtree and
// re-issuing every draw call. A picture is resolution independent, so pan and zoom replay it as
// is; an edit drops only the recordings of the page-level containers it touched.
//
// `invalidate*` is told about every change (`RenderBackend.invalidate`); `topLevelOf` finds the
// page-level container a node lives in. Entries hold the picture or `small`, the verdict that a
// container is too cheap to be worth recording, which is dropped on the same rules.

import type { Canvas, CanvasKit, SkPicture } from 'canvaskit-wasm';
import type { Change, NodeId } from '../document/types';
import type { SkiaTracker } from './ownership';
import type { SceneChange, SceneSource } from './sceneSource';

/** Subtrees with fewer nodes than this are drawn directly. */
export const MIN_NODES_TO_RECORD = 40;

export type CacheEntry = { kind: 'small' } | { kind: 'picture'; picture: SkPicture };

export class PictureCache {
	private readonly entries = new Map<NodeId, CacheEntry>();
	/** Recordings made since construction; tests assert "not re-recorded" with it. */
	recordedCount = 0;

	constructor(
		private readonly canvasKit: CanvasKit,
		private readonly tracker: SkiaTracker
	) {}

	get size(): number {
		return this.entries.size;
	}

	lookup(id: NodeId): CacheEntry | undefined {
		return this.entries.get(id);
	}

	markSmall(id: NodeId): void {
		this.remove(id);
		this.entries.set(id, { kind: 'small' });
	}

	/** Records `draw` into a picture for container `id`. */
	record(id: NodeId, draw: (recordingCanvas: Canvas) => void): SkPicture {
		const recorder = new this.canvasKit.PictureRecorder();
		try {
			// the box only bounds the recording; the picture builds an R-tree so replays skip what
			// the clip excludes
			const canvas = recorder.beginRecording(HUGE_BOX, true);
			draw(canvas);
			const picture = this.tracker.track(recorder.finishRecordingAsPicture());
			this.remove(id);
			this.entries.set(id, { kind: 'picture', picture });
			this.recordedCount += 1;
			return picture;
		} finally {
			recorder.delete();
		}
	}

	invalidate(source: SceneSource, change: SceneChange | 'everything'): void {
		if (change === 'everything' || change.kind === 'reset') {
			this.clear();
			return;
		}
		for (const node of change.changes) this.invalidateChange(source, node);
	}

	clear(): void {
		for (const id of this.entries.keys()) this.remove(id);
	}

	dispose(): void {
		this.clear();
	}

	private invalidateChange(source: SceneSource, change: Change): void {
		switch (change.t) {
			case 'add':
				this.invalidateFrom(source, change.node.id, change.node.parentId);
				return;
			case 'del':
				this.remove(change.node.id);
				this.invalidateFrom(source, change.node.parentId, null);
				return;
			case 'set':
				this.invalidateFrom(source, change.id, null);
				return;
			case 'move':
				this.invalidateFrom(source, change.id, change.parent);
				this.invalidateFrom(source, change.prevParent, null);
				return;
			default:
				// styles, variables and assets are resolved into the nodes that use them; a changed
				// entity can affect any container
				this.clear();
		}
	}

	private invalidateFrom(source: SceneSource, id: NodeId | null, also: NodeId | null): void {
		for (const start of [id, also]) {
			if (start === null) continue;
			const top = topLevelOf(source, start);
			if (top !== null) this.remove(top);
			this.remove(start);
		}
	}

	private remove(id: NodeId): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.entries.delete(id);
		if (entry.kind === 'picture') entry.picture.delete();
	}
}

const HUGE = 1e7;
const HUGE_BOX = Float32Array.of(-HUGE, -HUGE, HUGE, HUGE);

/** The ancestor (or the node itself) whose parent is a page, or null for a page or unknown id. */
export function topLevelOf(source: SceneSource, id: NodeId): NodeId | null {
	let current = source.getNode(id);
	while (current && current.type !== 'PAGE') {
		if (current.parentId === null) return null;
		const parent = source.getNode(current.parentId);
		if (parent && parent.type === 'PAGE') return current.id;
		current = parent;
	}
	return null;
}
