// Typed errors of the document store. They cross IPC as `HANDLER_FAILED: <message>` (the bridge
// keeps only the message), so every message reads as a sentence a user can be shown.

export type StoreErrorCode =
	| 'NOT_FOUND'
	| 'ALREADY_EXISTS'
	| 'NOT_A_DESIGN_FILE'
	| 'NEWER_VERSION'
	| 'CORRUPT'
	| 'CLOSED'
	| 'NO_STORE';

export class StoreError extends Error {
	constructor(
		readonly code: StoreErrorCode,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'StoreError';
	}
}

/** SQLite error codes that mean the file itself is damaged or is not a database. */
const CORRUPTION_ERRCODES = new Set([
	11, // SQLITE_CORRUPT
	26, // SQLITE_NOTADB
	10, // SQLITE_IOERR
	14 // SQLITE_CANTOPEN
]);

function errcodeOf(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const code: unknown = Reflect.get(error, 'errcode');
	if (typeof code === 'number') return code;
	return undefined;
}

/** Turn whatever `node:sqlite` or JSON parsing threw into a StoreError the UI can show. */
export function asStoreError(error: unknown, path: string): StoreError {
	if (error instanceof StoreError) return error;
	const errcode = errcodeOf(error);
	const detail = error instanceof Error ? error.message : String(error);
	if (errcode !== undefined && CORRUPTION_ERRCODES.has(errcode)) {
		return new StoreError('CORRUPT', `${path} is damaged and cannot be read (${detail})`, {
			cause: error
		});
	}
	if (error instanceof SyntaxError) {
		return new StoreError('CORRUPT', `${path} contains unreadable data (${detail})`, {
			cause: error
		});
	}
	return new StoreError('CORRUPT', `${path} could not be read (${detail})`, { cause: error });
}
