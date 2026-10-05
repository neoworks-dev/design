// Runtime validation of IPC payloads, checked by `route()` before a handler runs. One schema per
// channel in `IpcContract`; the mapped type makes a missing or mistyped schema a compile error.
// Main only: the preload is sandboxed and must not import this file.

import { z } from 'zod';
import type { CreateStoreRequest, IpcChannel, IpcContract, NativeMenuItem } from './bridge';
import { designDocumentSchema, transactionSchema } from '../src/lib/document/schema';

const fileFilter = z.strictObject({ name: z.string(), extensions: z.array(z.string()) });
const openFileOptions = z
	.strictObject({
		title: z.string().optional(),
		defaultPath: z.string().optional(),
		filters: z.array(fileFilter).optional(),
		multiple: z.boolean().optional()
	})
	.optional();
const saveFileOptions = z
	.strictObject({
		title: z.string().optional(),
		defaultPath: z.string().optional(),
		filters: z.array(fileFilter).optional()
	})
	.optional();

const fontRef = z.strictObject({ family: z.string().min(1), style: z.string().min(1) });
/** One image or font file; more than this is a mistake, not a document. */
const MAX_BLOB_BYTES = 512 * 1024 * 1024;
const blobBytes = z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= MAX_BLOB_BYTES);
const pixelSize = z.number().int().positive();
const storePath = z.string().min(1);
const createStoreRequest: z.ZodType<CreateStoreRequest> = z.strictObject({
	path: storePath,
	document: designDocumentSchema.optional()
});

const nativeMenuItem: z.ZodType<NativeMenuItem> = z.lazy(() =>
	z.strictObject({
		label: z.string(),
		accelerator: z.string().optional(),
		enabled: z.boolean(),
		checked: z.boolean(),
		command: z.string().optional(),
		args: z.unknown().optional(),
		separatorBefore: z.boolean(),
		submenu: z.array(nativeMenuItem).optional()
	})
);

/** More than this in one message is a bug in the sender, not a batch. */
const MAX_TRANSACTIONS_PER_COMMIT = 5000;

const settingsData = z.strictObject({
	core: z.record(z.string(), z.unknown()),
	plugins: z.record(z.string(), z.record(z.string(), z.unknown()))
});

const aiToolDefinition = z.strictObject({
	name: z.string().min(1).max(64),
	description: z.string().max(4000),
	inputSchema: z.record(z.string(), z.unknown()),
	write: z.boolean()
});
const sessionId = z.string().min(1);

export type PayloadSchemas = {
	[Channel in IpcChannel]: z.ZodType<IpcContract[Channel]['payload']>;
};

export const payloadSchemas: PayloadSchemas = {
	'window:minimize': z.void(),
	'window:toggleMaximize': z.void(),
	'window:close': z.void(),
	'window:isMaximized': z.void(),
	'app:version': z.void(),
	'app:path': z.enum(['userData', 'documents', 'downloads', 'temp', 'home']),
	'app:quit': z.void(),
	'app:bootReport': z.void(),
	'diagnostics:read': z.void(),
	'diagnostics:restart': z.strictObject({ safeMode: z.boolean() }),
	'dialogs:openFile': openFileOptions,
	'dialogs:saveFile': saveFileOptions,
	'dialogs:openImages': z.void(),
	'exports:write': z.strictObject({
		files: z
			.array(z.strictObject({ name: z.string().min(1).max(255), bytes: blobBytes }))
			.min(1)
			.max(500)
	}),
	'clipboard:read': z.void(),
	'clipboard:write': z.strictObject({
		text: z.string().optional(),
		html: z.string().optional(),
		png: blobBytes.optional()
	}),
	'menu:set': z.array(nativeMenuItem).max(32),
	'fonts:list': z.void(),
	'fonts:load': fontRef,
	'store:open': z.strictObject({ path: storePath }),
	'store:create': createStoreRequest,
	'store:load': z.void(),
	'store:close': z.void(),
	'store:commit': z.strictObject({
		transactions: z.array(transactionSchema).max(MAX_TRANSACTIONS_PER_COMMIT)
	}),
	'store:checkpoint': z.void(),
	'files:openInTab': z.strictObject({ path: storePath }),
	'files:newInTab': z.void(),
	'files:confirmClose': z.void(),
	'files:discard': z.strictObject({ path: storePath }),
	'files:newUntitled': z.void(),
	'files:open': z.strictObject({ path: storePath }),
	'files:openDialog': z.void(),
	'files:saveDialog': z.strictObject({ suggestedName: z.string() }),
	'files:saveAs': z.strictObject({ path: storePath }),
	'files:offerRecovery': z.void(),
	'files:launchRequest': z.void(),
	'assets:put': z.strictObject({
		mime: z.string().min(1),
		bytes: blobBytes,
		width: pixelSize.optional(),
		height: pixelSize.optional()
	}),
	'assets:get': z.strictObject({ hash: z.string().regex(/^[0-9a-f]{64}$/) }),
	'assets:collect': z.void(),
	'assets:embedFont': z.strictObject({
		family: z.string().min(1),
		style: z.string().min(1),
		bytes: blobBytes
	}),
	'assets:fontBytes': fontRef,
	'assets:embeddedFonts': z.void(),
	'settings:load': z.void(),
	'settings:save': settingsData,
	'ai:providers': z.void(),
	'ai:start': z.strictObject({
		provider: z.string().min(1),
		model: z.string().min(1).optional(),
		system: z.string().max(100_000),
		tools: z.array(aiToolDefinition).max(64)
	}),
	'ai:send': z.strictObject({
		sessionId,
		runId: z.string().min(1),
		prompt: z.string().min(1).max(200_000)
	}),
	'ai:cancel': z.strictObject({ sessionId }),
	'ai:end': z.strictObject({ sessionId }),
	'ai:toolResult': z.strictObject({
		callId: z.string().min(1),
		ok: z.boolean(),
		text: z.string().max(2_000_000)
	}),
	'files:recent': z.void(),
	'files:drafts': z.void(),
	'files:removeRecent': z.strictObject({ path: storePath }),
	'files:reveal': z.strictObject({ path: storePath }),
	'files:clearRecent': z.void(),
	'files:setThumbnail': z.strictObject({
		mime: z.string().min(1),
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		bytes: z.instanceof(Uint8Array)
	}),
	'files:flushed': z.strictObject({ requestId: z.string().min(1) })
};
