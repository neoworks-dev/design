// Path commands (src/lib/document/outline.ts) to Skia paths. Every path is owned by the frame's
// scope, so nothing outlives the frame.

import type { CanvasKit, Path, PathBuilder } from 'canvaskit-wasm';
import type { FillRule, PathCommand } from '../../document/outline';
import type { DrawContext } from './context';

export function skiaPath(
	context: DrawContext,
	commands: readonly PathCommand[],
	fillRule: FillRule
): Path {
	return context.scope.own(pathFromCommands(context.canvasKit, commands, fillRule));
}

/** The caller owns (and deletes) the returned path. */
export function pathFromCommands(
	canvasKit: CanvasKit,
	commands: readonly PathCommand[],
	fillRule: FillRule
): Path {
	const builder = new canvasKit.PathBuilder();
	for (const command of commands) appendCommand(builder, command);
	if (fillRule === 'EVENODD') builder.setFillType(canvasKit.FillType.EvenOdd);
	return builder.detachAndDelete();
}

function appendCommand(builder: PathBuilder, command: PathCommand): void {
	switch (command.op) {
		case 'move':
			builder.moveTo(command.x, command.y);
			return;
		case 'line':
			builder.lineTo(command.x, command.y);
			return;
		case 'cubic':
			builder.cubicTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y);
			return;
		case 'arc':
			builder.arcToRotated(
				command.radiusX,
				command.radiusY,
				0,
				true,
				!command.clockwise,
				command.x,
				command.y
			);
			return;
		case 'close':
			builder.close();
			return;
	}
}
