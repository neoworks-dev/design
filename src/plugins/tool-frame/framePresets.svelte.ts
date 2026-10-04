import type { Context } from '@neoworks/extension-system';
import { applyEdit } from '../../lib/editing/contribute';
import type { FramePreset } from './presets';

/** The preset waiting for the next click of the frame tool (none while a frame is selected). */
export class FramePresetState {
	armed = $state.raw<FramePreset | null>(null);
}

/**
 * Choosing a preset: with a frame selected it resizes and renames that frame (one undo step);
 * otherwise the next frame the tool draws, by click, gets the preset size and name.
 */
export function chooseFramePreset(
	ctx: Context,
	state: FramePresetState,
	preset: FramePreset
): void {
	const frame = selectedFrame(ctx);
	if (!frame) {
		state.armed = preset;
		return;
	}
	state.armed = null;
	const changes = ctx.document.setProps(frame, {
		width: preset.width,
		height: preset.height,
		name: preset.name
	});
	applyEdit(ctx, changes, `Frame preset ${preset.name}`);
}

function selectedFrame(ctx: Context): string | undefined {
	const nodes = ctx.selection.nodes();
	if (nodes.length !== 1) return undefined;
	if (nodes[0].type !== 'FRAME') return undefined;
	return nodes[0].id;
}
