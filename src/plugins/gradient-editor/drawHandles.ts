import type { GradientPaint } from '../../lib/document';
import { rgbaCss } from '../../lib/ui/colorMath';
import { NodeSpace, placedTargets } from '../../lib/editing/gradientCanvas';
import type { OverlayFrame } from '../../lib/overlay/types';

const ACCENT = '#0d99ff';
const HANDLE_RADIUS = 5;
const STOP_RADIUS = 6;

function circle(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	fill: string
): void {
	context.beginPath();
	context.arc(x, y, radius, 0, Math.PI * 2);
	context.fillStyle = fill;
	context.fill();
	context.lineWidth = 2;
	context.strokeStyle = '#fff';
	context.stroke();
}

/** The gradient axis, the width handle's guide, the three handles and the stops on the axis. */
export function drawGradientHandles(
	frame: OverlayFrame,
	paint: GradientPaint,
	space: NodeSpace,
	selectedStop: number
): void {
	const context = frame.ctx;
	const placed = placedTargets(paint, space).map((entry) => ({
		target: entry.target,
		screen: frame.worldToScreen(entry.world)
	}));
	const [origin, end, width] = placed;
	context.lineWidth = 1.5;
	context.strokeStyle = ACCENT;
	context.beginPath();
	context.moveTo(origin.screen.x, origin.screen.y);
	context.lineTo(end.screen.x, end.screen.y);
	context.stroke();
	context.setLineDash([4, 3]);
	context.beginPath();
	context.moveTo(origin.screen.x, origin.screen.y);
	context.lineTo(width.screen.x, width.screen.y);
	context.stroke();
	context.setLineDash([]);

	placed.forEach((entry) => {
		if (entry.target.kind !== 'stop') return;
		const stop = paint.gradientStops[entry.target.index];
		circle(context, entry.screen.x, entry.screen.y, STOP_RADIUS, rgbaCss(stop.color, 1));
		if (entry.target.index !== selectedStop) return;
		context.beginPath();
		context.arc(entry.screen.x, entry.screen.y, STOP_RADIUS + 3, 0, Math.PI * 2);
		context.lineWidth = 2;
		context.strokeStyle = ACCENT;
		context.stroke();
	});
	for (const handle of [origin, end, width]) {
		circle(context, handle.screen.x, handle.screen.y, HANDLE_RADIUS, ACCENT);
	}
}
