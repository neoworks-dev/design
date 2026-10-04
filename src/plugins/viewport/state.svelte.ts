// The reactive part of the viewport: the camera of the page being shown, the canvas size, and the
// cameras remembered for the pages that are not shown. The service delegates here because
// services hold no runes.

import type { NodeId } from '../../lib/document/types';
import type { Size } from '../../lib/kernel/types';
import { defaultCamera, type Camera } from '../../lib/viewport/camera';

export class ViewportState {
	camera = $state.raw<Camera>(defaultCamera());
	size = $state.raw<Size>({ width: 0, height: 0 });
	pageId = $state.raw<NodeId | null>(null);
	/** A page never shown before still wants its first "fit all" once there is room and content. */
	pendingFit = false;

	// Plain record, not reactive: only the camera of the shown page is observed by the UI.
	private readonly saved: Record<NodeId, Camera> = {};

	setCamera(camera: Camera): void {
		this.camera = camera;
	}

	setSize(size: Size): void {
		this.size = size;
	}

	hasSavedCamera(pageId: NodeId): boolean {
		return Object.hasOwn(this.saved, pageId);
	}

	/**
	 * Remembers the camera of the page being left and restores the one of `pageId`. Returns false
	 * when `pageId` has no remembered camera (first visit): the camera is then the default and
	 * `pendingFit` is set.
	 */
	switchPage(pageId: NodeId | null): boolean {
		if (pageId === this.pageId) return true;
		if (this.pageId !== null) this.saved[this.pageId] = this.camera;
		this.pageId = pageId;
		if (pageId === null) {
			this.camera = defaultCamera();
			this.pendingFit = false;
			return true;
		}
		if (this.hasSavedCamera(pageId)) {
			this.camera = this.saved[pageId];
			this.pendingFit = false;
			return true;
		}
		this.camera = defaultCamera();
		this.pendingFit = true;
		return false;
	}

	snapshot(): { pageId: NodeId | null; camera: Camera; remembered: NodeId[] } {
		return { pageId: this.pageId, camera: this.camera, remembered: Object.keys(this.saved).sort() };
	}
}
