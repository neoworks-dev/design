// The seam between main-ai and an agent harness: real (`@neoworks/harness`, harnessAgents.ts) or
// scripted (tests and `DESIGN_QA_AI=fake`, scriptedAgents.ts). Plain interfaces, so no plugin
// imports the harness package.

import type { AiProviderInfo, AiStreamEvent, AiToolDefinition } from '../bridge';

/** What a document tool call answers with, as the model sees it. */
export interface AgentToolResult {
	ok: boolean;
	text: string;
}

export interface AgentStartInit {
	provider: string;
	model?: string;
	system: string;
	tools: AiToolDefinition[];
	/** Where a harness reaches `tools` over MCP; `null` when the host does not use MCP. */
	mcp: { name: string; url: string; token: string } | null;
	/** Runs one document tool in the renderer. Scripted agents call it directly, no MCP. */
	callTool(name: string, input: unknown): Promise<AgentToolResult>;
	/** Provider credentials and routing from settings. They never leave main. */
	env: Record<string, string>;
}

export interface AgentSession {
	/** One turn. Yields text, thoughts and tool calls; the caller adds `done` itself. */
	prompt(text: string): AsyncIterable<AiStreamEvent>;
	/** Stop the running turn. */
	cancel(): Promise<void>;
	/** End the session; an unfinished turn is cancelled. */
	dispose(): Promise<void>;
}

export interface AgentHost {
	/** Whether sessions reach the document tools through an MCP endpoint of main's. */
	readonly usesMcp: boolean;
	providers(): Promise<AiProviderInfo[]>;
	start(init: AgentStartInit): Promise<AgentSession>;
}
