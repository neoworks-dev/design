// Runtime validation of IPC payloads, checked by `route()` before a handler runs. One schema per
// channel in `IpcContract`; the mapped type makes a missing or mistyped schema a compile error.
// Main only: the preload is sandboxed and must not import this file.

import { z } from 'zod';
import type { CreateStoreRequest, IpcChannel, IpcContract } from './bridge';
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

const storePath = z.string().min(1);
const createStoreRequest: z.ZodType<CreateStoreRequest> = z.strictObject({
	path: storePath,
	document: designDocumentSchema.optional()
});

/** More than this in one message is a bug in the sender, not a batch. */
const MAX_TRANSACTIONS_PER_COMMIT = 5000;

export type PayloadSchemas = {
	[Channel in IpcChannel]: z.ZodType<IpcContract[Channel]['payload']>;
};

export const payloadSchemas: PayloadSchemas = {
	'window:minimize': z.void(),
	'window:toggleMaximize': z.void(),
	'window:close': z.void(),
	'app:version': z.void(),
	'app:path': z.enum(['userData', 'documents', 'downloads', 'temp', 'home']),
	'app:quit': z.void(),
	'app:bootReport': z.void(),
	'dialogs:openFile': openFileOptions,
	'dialogs:saveFile': saveFileOptions,
	'store:open': z.strictObject({ path: storePath }),
	'store:create': createStoreRequest,
	'store:load': z.void(),
	'store:close': z.void(),
	'store:commit': z.strictObject({
		transactions: z.array(transactionSchema).max(MAX_TRANSACTIONS_PER_COMMIT)
	}),
	'store:checkpoint': z.void(),
	'files:newUntitled': z.void(),
	'files:open': z.strictObject({ path: storePath }),
	'files:openDialog': z.void(),
	'files:saveDialog': z.strictObject({ suggestedName: z.string() }),
	'files:saveAs': z.strictObject({ path: storePath }),
	'files:offerRecovery': z.void(),
	'files:launchRequest': z.void(),
	'files:flushed': z.strictObject({ requestId: z.string().min(1) })
};
