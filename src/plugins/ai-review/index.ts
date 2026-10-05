import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { drawAiHighlight } from '../../lib/ai/drawHighlight';
import { AiReviewService } from '../../lib/services/aiReview';
import { AiReviewState } from '../../lib/services/aiReviewState.svelte';
import ReviewBar from './ReviewBar.svelte';

const aiReviewConfigSchema = z
	.object({
		reviewMode: z
			.boolean()
			.default(false)
			.describe(
				'Hold each AI run for accept or reject after it is applied (off: edits are simply kept).'
			)
	})
	.prefault({});
type AiReviewConfig = z.infer<typeof aiReviewConfigSchema>;

const REVIEW_COLOR = '#f5a623';
const REVIEW_FILL = 'rgba(245, 166, 35, 0.1)';

// Review of AI edits (#151). The run is applied (one undo step) and, in review mode, held: its
// layers are outlined and a bar offers Accept (keep) and Reject (take back exactly, through
// aiHistory). Commands: `ai-review.toggle`, `ai-review.accept`, `ai-review.reject`.
export default {
	name: 'ai-review',
	inject: ['ai', 'aiHistory', 'history', 'document', 'overlay', 'regions', 'commands'],
	Config: aiReviewConfigSchema,
	apply(ctx: Context, config: AiReviewConfig): void {
		const state = new AiReviewState();
		state.enabled = config.reviewMode;
		const review = new AiReviewService(ctx, ctx.aiHistory, ctx.document, state);

		ctx.on('ai/run-end', (run, status) => review.handleRunEnd(run, status));
		ctx.on('document/replace', () => review.handleDocumentReplace());

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'ai-review/pending',
					order: 43,
					track: () => {
						void review.pendingNodeIds();
						void ctx.document.revision;
					},
					draw: (frame) => {
						const pageId = ctx.document.currentPageId;
						const bounds = review
							.pendingNodeIds()
							.filter((id) => ctx.document.pageOf(id).id === pageId)
							.map((id) => ctx.document.absoluteBounds(id));
						if (bounds.length > 0) drawAiHighlight(frame, bounds, REVIEW_COLOR, REVIEW_FILL);
					}
				}),
			'ai review overlay'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'ai-review/bar',
					region: 'canvas-overlay',
					component: ReviewBar
				}),
			'ai review bar'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai-review.toggle',
					title: 'Review AI changes before keeping them',
					run: () => review.setEnabled(!review.enabled)
				}),
			'command ai-review.toggle'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai-review.accept',
					title: 'Accept AI changes',
					run: () => review.acceptAll()
				}),
			'command ai-review.accept'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai-review.reject',
					title: 'Reject AI changes',
					run: () => review.rejectAll()
				}),
			'command ai-review.reject'
		);
	}
};
