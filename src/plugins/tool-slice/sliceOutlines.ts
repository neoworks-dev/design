// Slices do not render: a dashed outline marks the export region and the label above it selects
// it. Drawn on the overlay; the label is a pointer claimant so a press on it selects the slice.

import type { Context } from '@neoworks/extension-system';
import type { Rect } from '../../lib/document';
import type { OverlayFrame } from '../../lib/overlay/types';
import type { PointerClaimant, PointerGrab } from '../../lib/tools/claim';
import type { ToolPointerEvent } from '../../lib/tools/protocol';

const LABEL_HEIGHT = 18;
const MIN_LABEL_WIDTH = 24;
const FALLBACK_COLOR = '#3b82f6';

interface Outline {
	id: string;
	name: string;
	box: Rect;
	selected: boolean;
}

function accentColor(): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
	if (value.trim() === '') return FALLBACK_COLOR;
	return value.trim();
}

export class SliceOutlines implements PointerClaimant {
	readonly id = 'tool-slice/outlines';

	constructor(private readonly ctx: Context) {}

	private outlines(): Outline[] {
		const camera = this.ctx.viewport.camera;
		const selectedIds = this.ctx.selection.ids;
		return this.ctx.document
			.query((node) => node.type === 'SLICE' && node.visible, this.ctx.document.currentPageId)
			.map((node) => {
				const bounds = this.ctx.document.absoluteBounds(node.id);
				return {
					id: node.id,
					name: node.name,
					box: {
						x: bounds.x * camera.scale + camera.x,
						y: bounds.y * camera.scale + camera.y,
						width: bounds.width * camera.scale,
						height: bounds.height * camera.scale
					},
					selected: selectedIds.includes(node.id)
				};
			});
	}

	private labelBox(outline: Outline): Rect {
		return {
			x: outline.box.x,
			y: outline.box.y - LABEL_HEIGHT,
			width: Math.max(MIN_LABEL_WIDTH, outline.box.width),
			height: LABEL_HEIGHT
		};
	}

	claim(event: ToolPointerEvent): PointerGrab | undefined {
		if (event.button !== 0) return undefined;
		const { x, y } = event.screen;
		const hit = this.outlines().find((outline) => {
			const label = this.labelBox(outline);
			return (
				x >= label.x && x <= label.x + label.width && y >= label.y && y <= label.y + label.height
			);
		});
		if (hit === undefined) return undefined;
		this.ctx.selection.select([hit.id]);
		return { move: () => undefined, up: () => undefined, cancel: () => undefined };
	}

	cursorAt(event: ToolPointerEvent): string | undefined {
		const { x, y } = event.screen;
		const over = this.outlines().some((outline) => {
			const label = this.labelBox(outline);
			return (
				x >= label.x && x <= label.x + label.width && y >= label.y && y <= label.y + label.height
			);
		});
		if (over) return 'pointer';
		return undefined;
	}

	track(): void {
		void this.ctx.selection.ids;
	}

	draw(frame: OverlayFrame): void {
		const canvas = frame.ctx;
		const color = accentColor();
		for (const outline of this.outlines()) {
			const { x, y, width, height } = outline.box;
			if (outline.selected) {
				canvas.globalAlpha = 0.1;
				canvas.fillStyle = color;
				canvas.fillRect(x, y, width, height);
				canvas.globalAlpha = 1;
			}
			canvas.setLineDash([4, 3]);
			canvas.lineWidth = 1;
			canvas.strokeStyle = color;
			canvas.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
			canvas.setLineDash([]);
			this.drawLabel(canvas, outline, color);
		}
	}

	private drawLabel(canvas: CanvasRenderingContext2D, outline: Outline, color: string): void {
		const label = this.labelBox(outline);
		canvas.save();
		canvas.beginPath();
		canvas.rect(label.x, label.y, label.width, label.height);
		canvas.clip();
		canvas.fillStyle = color;
		canvas.font = '12px sans-serif';
		canvas.textAlign = 'left';
		canvas.fillText(outline.name, label.x, label.y + 13);
		canvas.restore();
	}
}
