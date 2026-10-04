// Runtime validation of IPC payloads, checked by `route()` before a handler runs. One schema per
// channel in `IpcContract`; the mapped type makes a missing or mistyped schema a compile error.
// Main only: the preload is sandboxed and must not import this file.

import { z } from 'zod';
import type { IpcChannel, IpcContract } from './bridge';

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
	'dialogs:openFile': openFileOptions,
	'dialogs:saveFile': saveFileOptions,
	'fonts:list': z.void(),
	'fonts:load': fontRef
};
