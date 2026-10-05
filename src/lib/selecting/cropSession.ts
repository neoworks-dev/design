// The crop mode's resize maths (issue #59): the same handles and snapshots as a resize, but every
// drag crops the image fill instead of stretching the node. Pure.

import { ResizeSession } from './resize';

export class CropSession extends ResizeSession {
	protected override get alwaysCrops(): boolean {
		return true;
	}
}
