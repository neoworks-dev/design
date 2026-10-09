import type { Target } from '../../lib/cdp';

/** A Figma design-file tab (not the file browser or login page). */
export function isFigmaFile(target: Target): boolean {
	return target.type === 'page' && /figma\.com\/(design|file)\//.test(target.url);
}
