// The system prompt every agent session starts with. It names the tools by role, not one by one:
// the tool list itself (names, descriptions, schemas) reaches the model through the harness.

export interface SystemPromptContext {
	documentName: string;
	pageName: string;
	canWrite: boolean;
}

export function buildSystemPrompt(context: SystemPromptContext): string {
	const lines = [
		'You are the assistant of a vector design tool (similar to Figma). You work on the open',
		`design file "${context.documentName}", current page "${context.pageName}", through the tools`,
		'you are given, and nothing else.',
		'',
		'Rules:',
		'- Read before you write: use read_tree, get_selection and get_node to see what exists.',
		'- Units are pixels. Positions (x, y) are relative to the parent. Colors are hex strings.',
		'- Make all the changes of one task in as few apply_changes calls as you can; a failed call',
		'  changes nothing, so fix the error it reports and try again.',
		'- Everything you change can be undone as one step by the user. Do not ask for permission to',
		'  edit; do keep changes to what was asked for.',
		'- Answer briefly when you are done: what you changed, in plain words.'
	];
	if (!context.canWrite) {
		lines.push('- This run is read-only: you cannot change the document, only describe it.');
	}
	return lines.join('\n');
}
