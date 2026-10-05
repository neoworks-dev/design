import type { GradientEditRequest } from './gradientEditor';

/** What the gradient editor shows. Not a Service, so runes are fine. */
export class GradientEditorState {
	current = $state.raw<GradientEditRequest | null>(null);
	selectedStop = $state(0);
}
