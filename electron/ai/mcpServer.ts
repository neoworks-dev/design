// A minimal MCP server (streamable HTTP, JSON responses, tools only) on 127.0.0.1. Harness agents
// (Claude Code, Codex, pi) are given its URL as an MCP server and call the document tools through
// it; each call is handed to `onCall`, which forwards it to the renderer. One endpoint per agent
// session (`/mcp/<sessionId>`), guarded by a random bearer token so other local processes cannot
// edit the document.

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AiToolDefinition } from '../bridge';
import type { AgentToolResult } from '../kernel/agentHost';

const PROTOCOL_VERSION = '2025-03-26';
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export const MCP_SERVER_NAME = 'design';

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

export interface McpSessionRegistration {
	tools: AiToolDefinition[];
	onCall(name: string, input: unknown): Promise<AgentToolResult>;
}

function isRequest(value: unknown): value is JsonRpcRequest {
	if (typeof value !== 'object' || value === null) return false;
	return typeof Reflect.get(value, 'method') === 'string';
}

function readBody(request: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		request.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error('request body too large'));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		request.on('error', reject);
	});
}

function reply(response: http.ServerResponse, status: number, body?: unknown): void {
	if (body === undefined) {
		response.writeHead(status).end();
		return;
	}
	response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function portOf(address: string | AddressInfo | null): number {
	if (address === null || typeof address === 'string') throw new Error('MCP server has no port');
	return address.port;
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown): unknown {
	return { jsonrpc: '2.0', id, result };
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string): unknown {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

export class McpServer {
	private server: http.Server | null = null;
	private readonly sessions = new Map<string, McpSessionRegistration>();
	private readonly token = randomBytes(24).toString('hex');
	private starting: Promise<number> | null = null;

	get listening(): boolean {
		return this.server !== null && this.server.listening;
	}

	/** Start listening (once) on a free port; resolves with it. */
	listen(): Promise<number> {
		if (this.starting) return this.starting;
		this.starting = new Promise<number>((resolve, reject) => {
			const server = http.createServer((request, response) => {
				void this.handle(request, response);
			});
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => {
				this.server = server;
				resolve(portOf(server.address()));
			});
		});
		return this.starting;
	}

	async close(): Promise<void> {
		const server = this.server;
		this.server = null;
		this.starting = null;
		this.sessions.clear();
		if (!server) return;
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	/** Serve `registration.tools` to one agent session; the disposer removes only that session. */
	async register(
		sessionId: string,
		registration: McpSessionRegistration
	): Promise<{ url: string; token: string; dispose: () => void }> {
		const port = await this.listen();
		this.sessions.set(sessionId, registration);
		return {
			url: `http://127.0.0.1:${port}/mcp/${sessionId}`,
			token: this.token,
			dispose: () => {
				if (this.sessions.get(sessionId) === registration) this.sessions.delete(sessionId);
			}
		};
	}

	private async handle(
		request: http.IncomingMessage,
		response: http.ServerResponse
	): Promise<void> {
		const session = this.authorize(request);
		if (session === null) {
			reply(response, 401, { error: 'unauthorized' });
			return;
		}
		if (request.method !== 'POST') {
			reply(response, 405, { error: 'POST only' });
			return;
		}
		try {
			const message: unknown = JSON.parse(await readBody(request));
			await this.dispatch(session, message, response);
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			reply(response, 400, rpcError(null, -32700, text));
		}
	}

	private authorize(request: http.IncomingMessage): McpSessionRegistration | null {
		if (request.headers.authorization !== `Bearer ${this.token}`) return null;
		const match = /^\/mcp\/([^/?]+)/.exec(request.url ?? '');
		if (!match) return null;
		return this.sessions.get(match[1]) ?? null;
	}

	private async dispatch(
		session: McpSessionRegistration,
		message: unknown,
		response: http.ServerResponse
	): Promise<void> {
		if (!isRequest(message)) {
			reply(response, 400, rpcError(null, -32600, 'not a JSON-RPC request'));
			return;
		}
		const id = message.id;
		if (id === undefined) {
			reply(response, 202);
			return;
		}
		reply(response, 200, await this.answer(session, message));
	}

	private async answer(session: McpSessionRegistration, message: JsonRpcRequest): Promise<unknown> {
		const id = message.id;
		if (message.method === 'initialize') {
			return rpcResult(id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: MCP_SERVER_NAME, version: '0.1.0' }
			});
		}
		if (message.method === 'ping') return rpcResult(id, {});
		if (message.method === 'tools/list') {
			return rpcResult(id, {
				tools: session.tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema
				}))
			});
		}
		if (message.method === 'tools/call')
			return rpcResult(id, await this.callTool(session, message));
		return rpcError(id, -32601, `method not found: ${message.method}`);
	}

	private async callTool(
		session: McpSessionRegistration,
		message: JsonRpcRequest
	): Promise<unknown> {
		const params = message.params ?? {};
		const name = params.name;
		if (typeof name !== 'string' || !session.tools.some((tool) => tool.name === name)) {
			return { content: [{ type: 'text', text: `unknown tool: ${String(name)}` }], isError: true };
		}
		const result = await session.onCall(name, params.arguments ?? {});
		return { content: [{ type: 'text', text: result.text }], isError: !result.ok };
	}
}
