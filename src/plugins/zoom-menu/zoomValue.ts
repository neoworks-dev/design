/** Menu path of the zoom dropdown. */
export const ZOOM_MENU = 'toolbar/zoom';

const MIN_PERCENT = 2;
const MAX_PERCENT = 25600;

/** A typed zoom (`150`, `150%`, `12,5 %`) as a percentage, or undefined when it is not a number. */
export function parseZoomPercent(text: string): number | undefined {
	const cleaned = text.trim().replace('%', '').replace(',', '.').trim();
	if (cleaned === '') return undefined;
	const value = Number(cleaned);
	if (!Number.isFinite(value) || value <= 0) return undefined;
	return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
}
