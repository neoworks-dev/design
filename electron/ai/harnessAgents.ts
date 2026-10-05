// The real agent host: `@neoworks/harness` drives Claude Code, Codex or pi against the user's own
// logins. A session gets main's MCP endpoint as its only tool source (`tools: 'none'`, full
// isolation from the user's personal harness config), so the model can read and edit the design
// document and nothing else. Imported by realHost only; tests use scriptedAgents.ts.

import {
	createHarness,
	type Effort,
	type Harness,
	type HarnessEvent,
	type HarnessInfo,
	type ModelInfo
} from '@neoworks/harness';
import type { AiImage, AiModelInfo, AiProviderInfo, AiStreamEvent, AiToolStatus } from '../bridge';
import type { AgentHost, AgentSession, AgentStartInit } from '../kernel/agentHost';

const HARNESS_LABELS: Record<string, string> = {
	claude: 'Claude Code',
	codex: 'Codex',
	pi: 'pi'
};

function textOfContent(content: unknown): string {
	if (typeof content !== 'object' || content === null) return '';
	if (Reflect.get(content, 'type') !== 'text') return '';
	const text = Reflect.get(content, 'text');
	if (typeof text !== 'string') return '';
	return text;
}

function toolStatus(status: unknown): AiToolStatus {
	if (status === 'completed') return 'done';
	if (status === 'failed') return 'failed';
	return 'running';
}

/** The tool name the model called, without the harness' `mcp__<server>__` prefix. */
function shortToolName(raw: string): string {
	const parts = raw.split('__');
	if (parts[0] !== 'mcp' || parts.length < 3) return raw;
	return parts.slice(2).join('__');
}

/** Maps one harness event to what the chat shows; `null` for events the chat ignores. */
export function streamEventOf(event: HarnessEvent): AiStreamEvent | null {
	if (event.type !== 'update') return null;
	const update = event.update;
	if (update.sessionUpdate === 'agent_message_chunk') {
		return { type: 'text', text: textOfContent(update.content) };
	}
	if (update.sessionUpdate === 'agent_thought_chunk') {
		return { type: 'thought', text: textOfContent(update.content) };
	}
	if (update.sessionUpdate === 'tool_call') {
		const rawName = Reflect.get(update, 'name');
		const name = shortToolName(typeof rawName === 'string' ? rawName : update.title);
		return {
			type: 'tool_call',
			callId: update.toolCallId,
			name,
			input: update.rawInput,
			status: toolStatus(update.status)
		};
	}
	if (update.sessionUpdate === 'tool_call_update') {
		const rawName = Reflect.get(update, 'name');
		const name = shortToolName(typeof rawName === 'string' ? rawName : (update.title ?? ''));
		return {
			type: 'tool_call',
			callId: update.toolCallId,
			name,
			status: toolStatus(update.status)
		};
	}
	return null;
}

type PromptContent = Parameters<Awaited<ReturnType<Harness['createSession']>>['prompt']>[0];

function promptContent(text: string, images: AiImage[]): PromptContent {
	if (images.length === 0) return text;
	return [
		{ type: 'text', text },
		...images.map((image) => ({
			type: 'image' as const,
			data: image.data,
			mimeType: image.mimeType
		}))
	];
}

/**
 * Codex lists every model once per effort (`gpt-6-sol[high]`, named "6 Sol (high)"). The chat
 * picks the effort separately, so the variants collapse into one entry per model.
 */
export function collapseEffortVariants(models: ModelInfo[]): AiModelInfo[] {
	const collapsed: AiModelInfo[] = [];
	for (const model of models) {
		const variant = /^(.+)\[[\w-]+\]$/.exec(model.id);
		if (variant === null) {
			collapsed.push({ id: model.id, name: model.name, description: model.description });
			continue;
		}
		const id = variant[1];
		if (collapsed.some((existing) => existing.id === id)) continue;
		collapsed.push({
			id,
			name: model.name.replace(/\s*\([\w-]+\)$/, ''),
			description: firstSentence(model.description)
		});
	}
	return collapsed;
}

function firstSentence(text: string | undefined): string | undefined {
	if (text === undefined) return undefined;
	const end = text.indexOf('. ');
	if (end === -1) return text;
	return text.slice(0, end + 1);
}

function isEffort(info: HarnessInfo, effort: string | undefined): effort is Effort {
	if (effort === undefined) return false;
	return info.efforts.some((candidate) => candidate === effort);
}

class HarnessAgentSession implements AgentSession {
	constructor(private readonly session: Awaited<ReturnType<Harness['createSession']>>) {}

	async *prompt(text: string, images: AiImage[]): AsyncGenerator<AiStreamEvent> {
		for await (const event of this.session.prompt(promptContent(text, images))) {
			const mapped = streamEventOf(event);
			if (mapped !== null) yield mapped;
		}
	}

	cancel(): Promise<void> {
		return this.session.cancel();
	}

	dispose(): Promise<void> {
		return this.session.dispose();
	}
}

function providerOf(info: HarnessInfo): AiProviderInfo {
	const label = HARNESS_LABELS[info.id];
	return {
		id: info.id,
		label: label === undefined ? info.id : label,
		available: info.available,
		detail: info.detail,
		models: [],
		images: info.capabilities.images,
		efforts: [...info.efforts]
	};
}

export class HarnessAgentHost implements AgentHost {
	readonly usesMcp = true;
	private harness: Promise<Harness> | null = null;
	/** What `providers` last saw; the renderer only offers efforts from there. */
	private infos: HarnessInfo[] = [];

	private getHarness(): Promise<Harness> {
		if (this.harness === null) this.harness = createHarness();
		return this.harness;
	}

	async providers(): Promise<AiProviderInfo[]> {
		const harness = await this.getHarness();
		const infos = await harness.listHarnesses();
		this.infos = infos;
		const providers = infos.map(providerOf);
		for (const provider of providers) {
			if (!provider.available) continue;
			const models = await harness.listModels(provider.id as HarnessInfo['id']).catch(() => []);
			provider.models = collapseEffortVariants(models);
		}
		return providers;
	}

	async start(init: AgentStartInit): Promise<AgentSession> {
		if (init.mcp === null) throw new Error('the harness agent needs an MCP endpoint');
		const harness = await this.getHarness();
		const info = this.infos.find((candidate) => candidate.id === init.provider);
		let effort: Effort | undefined;
		if (info !== undefined && isEffort(info, init.effort)) effort = init.effort;
		const session = await harness.createSession({
			harness: init.provider as HarnessInfo['id'],
			mcpServers: [
				{
					type: 'http',
					name: init.mcp.name,
					url: init.mcp.url,
					headers: [{ name: 'Authorization', value: `Bearer ${init.mcp.token}` }]
				}
			],
			options: {
				systemPrompt: { replace: init.system },
				tools: 'none',
				isolation: 'full',
				disable: 'all',
				model: init.model,
				effort
			},
			// Only the design server's tools exist in this session, so every request is ours.
			onPermission: () => 'once',
			env: init.env
		});
		return new HarnessAgentSession(session);
	}
}
