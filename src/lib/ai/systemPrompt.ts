// The system prompt every agent session starts with. It replaces the harness' own prompt, so it
// stays short: what the agent works on, how the document looks to it (HTML), and the index of
// skills it can load for details. Tool names, descriptions and schemas reach the model through
// the harness.

export interface SystemPromptContext {
	documentName: string;
	pageName: string;
	canWrite: boolean;
	/** Names of the tools this session offers. */
	tools?: readonly string[];
	/** Skills the agent can load with the `skill` tool. */
	skills?: readonly { id: string; summary: string }[];
	/** Skill texts the session always needs, appended in full. */
	guides?: readonly string[];
}

export function buildSystemPrompt(context: SystemPromptContext): string {
	const tools = context.tools ?? [];
	const lines = [
		'You are the assistant of a vector design tool (similar to Figma). You work on the open',
		`design file "${context.documentName}", current page "${context.pageName}", through the tools`,
		'you are given, and nothing else.',
		'',
		'The document reads and writes as HTML with inline CSS: a frame is a <div>, auto layout is',
		'flexbox (gap, padding, align-items, justify-content), a text layer is a <p>, a component',
		'instance has data-component, and every layer carries data-id. Values bound to variables',
		'appear as var(--name). Use plain HTML and CSS: no scripts, no external stylesheets, fonts or',
		'images, no Tailwind.',
		'',
		'Rules:',
		'- Look before you change: read what is there; take a screenshot to check what you made.',
		'- Keep data-id on elements you rewrite, so those layers keep their identity.',
		'- Prefer flexbox with gap over margins; give every element a descriptive data-name.',
		'- A failed call changes nothing: fix what the error says and try again.',
		'- Everything you change can be undone as one step. Do not ask for permission to edit; do',
		'  keep changes to what was asked for.',
		'- Answer briefly when you are done: what you changed, in plain words.'
	];
	if (!context.canWrite) {
		lines.push('- This run is read-only: you cannot change the document, only describe it.');
	}
	const skills = context.skills ?? [];
	if (skills.length > 0 && tools.includes('skill')) {
		lines.push('', 'Skills (load one with the skill tool when the task needs it):');
		for (const skill of skills) lines.push(`- ${skill.id}: ${skill.summary}`);
	}
	for (const guide of context.guides ?? []) lines.push('', guide);
	return lines.join('\n');
}
