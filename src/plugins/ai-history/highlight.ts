import type { Rect } from '../../lib/document';
import { drawAiHighlight } from '../../lib/ai/drawHighlight';
import type { OverlayFrame } from '../../lib/overlay/types';
import type { AiHistoryService } from '../../lib/services/aiHistory';
import type { DocumentService } from '../../lib/services/document';

/** Outline the nodes of the last AI run that are on the current page. */
export function drawAiHistoryHighlight(
	frame: OverlayFrame,
	document: DocumentService,
	aiHistory: AiHistoryService
): void {
	const pageId = document.currentPageId;
	const bounds: Rect[] = [];
	for (const id of aiHistory.highlightedIds) {
		if (document.pageOf(id).id !== pageId) continue;
		bounds.push(document.absoluteBounds(id));
	}
	if (bounds.length > 0) drawAiHighlight(frame, bounds);
}
