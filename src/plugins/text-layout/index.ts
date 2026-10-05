import type { Context } from '@neoworks/extension-system';
import { TextLayoutEngine } from '../../lib/text/layoutEngine';
import type { TextNode } from '../../lib/document';
import { TextLayoutService } from './service';

// Text for the renderer: lays text out with Skia's Paragraph, draws it through the `drawText`
// hook and answers geometry questions (size, caret, selection, hit test) as `ctx.textLayout`.
// Fonts come from `fonts`: the engine is attached as its sink, loaded faces are registered in
// Skia and everything is laid out again. A text node keeps its font reference when the font is
// missing; the substitute is chosen at layout time and never written back.
// Auto-width and auto-height text boxes are fitted in the same transaction as the edit that
// changed their text (a `document/append` step), so the stored size always matches the layout.
export default {
	name: 'text-layout',
	inject: ['renderer', 'canvaskit', 'fonts', 'document', 'variables'],
	apply(ctx: Context): void {
		const { kit, tracker } = ctx.canvaskit;
		const engine = new TextLayoutEngine(kit, tracker, (ref) => ctx.fonts.resolve(ref));
		const resolveNode = (id: string): TextNode | undefined => {
			const node = ctx.variables.resolvedNode(id);
			if (node.type !== 'TEXT') return undefined;
			return node;
		};
		const service = new TextLayoutService(ctx, engine, resolveNode, (ref) => ctx.fonts.load(ref));
		ctx.effect(() => () => engine.dispose(), 'text-layout/skia paragraphs');

		ctx.fonts.attach({
			registerFont: (face, bytes) => {
				engine.registerFont(face, bytes);
				ctx.emit('renderer/need-frame', 'font loaded');
			}
		});
		ctx.on('fonts/changed', () => {
			engine.invalidateAll();
			ctx.emit('renderer/need-frame', 'fonts changed');
		});
		ctx.on('document/replace', () => engine.clear());
		ctx.on('document/change', (event) => {
			for (const change of event.transaction.changes) {
				if (change.t === 'del' && change.node.type === 'TEXT') engine.forget(change.node.id);
			}
		});
		ctx.on('document/append', ({ changes }, next) => [
			...next(),
			...service.fitChangesFor(changes)
		]);

		ctx.effect(
			() =>
				ctx.renderer.registerDrawHooks({
					drawText: (context, node) => {
						service.layoutOf(node);
						engine.draw(context.canvas, node);
					}
				}),
			'text-layout/draw hook'
		);
	}
};
