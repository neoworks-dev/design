/** What the link prompt shows. Not a Service, so runes are fine. */
export class TextFormatState {
	/** `null` while the prompt is closed. */
	linkPrompt = $state.raw<{ url: string } | null>(null);
}
