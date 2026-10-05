// Runtime validation of IPC payloads, checked by `route()` before a handler runs. One schema per
// channel in `IpcContract`; the mapped type makes a missing or mistyped schema a compile error.
// Main only: the preload is sandboxed and must not import this file.

import { z } from 'zod';
import { isSafeArchivePath } from './archive/zip';
import type {
	CreateFromArchiveRequest,
	CreateStoreRequest,
	IpcChannel,
	IpcContract,
	NativeMenuItem
} from './bridge';
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
/** A file or folder name: one path segment, so no separators and no `..`. */
const libraryName = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.refine((name) => !/[/\\\0]/.test(name) && name !== '.' && !name.includes('..'), {
		message: 'must be a single name without path separators or ".."'
	});
const pluginIdSchema = z
	.string()
	.regex(/^[a-z][a-z0-9-]*$/)
	.max(64);
const storageKeySchema = z.string().min(1).max(256);
const createStoreRequest: z.ZodType<CreateStoreRequest> = z.strictObject({
	path: storePath,
	document: designDocumentSchema.optional()
});

const archiveEntry = z.strictObject({
	path: z.string().min(1).max(1024).refine(isSafeArchivePath),
	bytes: blobBytes
});
const createFromArchiveRequest: z.ZodType<CreateFromArchiveRequest> = z.strictObject({
	document: designDocumentSchema,
	images: z.array(
		z.strictObject({
			hash: z.string().min(1),
			mime: z.string().min(1),
			width: pixelSize.optional(),
			height: pixelSize.optional(),
			bytes: blobBytes
		})
	),
	fonts: z.array(
		z.strictObject({ family: z.string().min(1), style: z.string().min(1), bytes: blobBytes })
	)
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
	'archive:export': z.strictObject({
		suggestedName: z.string().min(1).max(255),
		entries: z.array(archiveEntry).min(1).max(100_000)
	}),
	'archive:read': z.void(),
	'archive:create': createFromArchiveRequest,
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
	'versions:list': z.void(),
	'versions:add': z.strictObject({ name: z.string().trim().min(1).max(200) }),
	'versions:remove': z.strictObject({ id: z.string().min(1).max(64) }),
	'versions:restorePlan': z.strictObject({ seq: z.number().int().min(0) }),
	'store:checkpoint': z.void(),
	'files:new': z.strictObject({ directory: storePath.optional() }),
	'files:open': z.strictObject({ path: storePath }),
	'files:openDialog': z.void(),
	'files:saveDialog': z.strictObject({ suggestedName: z.string() }),
	'files:saveAs': z.strictObject({ path: storePath }),
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
		effort: z.string().min(1).optional(),
		system: z.string().max(100_000),
		tools: z.array(aiToolDefinition).max(64)
	}),
	'ai:send': z.strictObject({
		sessionId,
		runId: z.string().min(1),
		prompt: z.string().min(1).max(200_000),
		images: z
			.array(
				z.strictObject({
					mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
					data: z.string().min(1).max(16_000_000)
				})
			)
			.max(8)
			.optional()
	}),
	'ai:cancel': z.strictObject({ sessionId }),
	'ai:end': z.strictObject({ sessionId }),
	'ai:toolResult': z.strictObject({
		callId: z.string().min(1),
		ok: z.boolean(),
		text: z.string().max(2_000_000)
	}),
	'plugins:list': z.void(),
	'plugins:setTrust': z.strictObject({ trusted: z.boolean() }),
	'plugins:readFile': z.strictObject({
		source: z.enum(['builtin', 'user', 'project']),
		directoryName: z.string().min(1).max(255),
		file: z.string().min(1).max(1024)
	}),
	'plugins:install': z.strictObject({ path: z.string().min(1).max(4096) }),
	'plugins:create': z.strictObject({
		id: pluginIdSchema,
		name: z.string().min(1).max(100),
		template: z.enum(['blank', 'panel', 'figma'])
	}),
	'plugins:installFromDialog': z.strictObject({ kind: z.enum(['folder', 'zip']) }),
	'plugins:remove': z.strictObject({ directoryName: z.string().min(1).max(255) }),
	'plugins:reveal': z.strictObject({
		source: z.enum(['builtin', 'user', 'project']),
		directoryName: z.string().min(1).max(255)
	}),
	'plugins:permissions': z.void(),
	'plugins:setPermission': z.strictObject({
		pluginId: pluginIdSchema,
		permission: z.string().min(1).max(50),
		granted: z.boolean().nullable()
	}),
	'plugins:fetch': z.strictObject({
		pluginId: pluginIdSchema,
		url: z.string().min(1).max(4096),
		method: z.string().min(1).max(10).optional(),
		headers: z.record(z.string(), z.string()).optional(),
		body: z.string().max(5_000_000).optional()
	}),
	'plugins:storageGet': z.strictObject({ pluginId: pluginIdSchema, key: storageKeySchema }),
	'plugins:storageSet': z.strictObject({
		pluginId: pluginIdSchema,
		key: storageKeySchema,
		value: z.unknown()
	}),
	'plugins:storageDelete': z.strictObject({ pluginId: pluginIdSchema, key: storageKeySchema }),
	'plugins:storageKeys': z.strictObject({ pluginId: pluginIdSchema }),
	'files:recent': z.void(),
	'files:removeRecent': z.strictObject({ path: storePath }),
	'files:reveal': z.strictObject({ path: storePath }),
	'files:clearRecent': z.void(),
	'files:setThumbnail': z.strictObject({
		mime: z.string().min(1),
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		bytes: z.instanceof(Uint8Array)
	}),
	'files:flushed': z.strictObject({ requestId: z.string().min(1) }),
	'library:overview': z.void(),
	'library:list': z.strictObject({ directory: storePath }),
	'library:search': z.strictObject({ query: z.string().max(200) }),
	'library:createFolder': z.strictObject({ parent: storePath, name: libraryName }),
	'library:renameFolder': z.strictObject({ path: storePath, name: libraryName }),
	'library:trashFolder': z.strictObject({ path: storePath }),
	'library:renameFile': z.strictObject({ path: storePath, name: libraryName }),
	'library:moveFile': z.strictObject({ path: storePath, directory: storePath }),
	'library:duplicateFile': z.strictObject({ path: storePath }),
	'library:trashFile': z.strictObject({ path: storePath }),
	'library:linkFolder': z.void(),
	'library:unlinkFolder': z.strictObject({ id: z.string().min(1).max(64) })
};
