// Reads the first 100 bytes of a file to tell, without opening a database connection, whether it
// is one of ours and which schema version it carries. Opening a connection to a WAL database can
// create `-wal` and `-shm` files; checking the header first guarantees that a file we refuse
// (not ours, or from a newer version) is never touched.

import { closeSync, openSync, readSync } from 'node:fs';
import {
	APPLICATION_ID,
	HEADER_OFFSET_APPLICATION_ID,
	HEADER_OFFSET_USER_VERSION,
	SQLITE_HEADER_SIZE,
	SQLITE_MAGIC
} from './constants';
import { StoreError } from './errors';

export interface FileHeader {
	applicationId: number;
	userVersion: number;
}

export function readHeader(path: string): FileHeader {
	const header = Buffer.alloc(SQLITE_HEADER_SIZE);
	let bytesRead = 0;
	const descriptor = openSync(path, 'r');
	try {
		bytesRead = readSync(descriptor, header, 0, SQLITE_HEADER_SIZE, 0);
	} finally {
		closeSync(descriptor);
	}
	if (bytesRead < SQLITE_HEADER_SIZE || header.toString('latin1', 0, 16) !== SQLITE_MAGIC) {
		throw new StoreError('NOT_A_DESIGN_FILE', `${path} is not a design file`);
	}
	return {
		applicationId: header.readUInt32BE(HEADER_OFFSET_APPLICATION_ID),
		userVersion: header.readUInt32BE(HEADER_OFFSET_USER_VERSION)
	};
}

/** Throws unless the file is a design file; returns its schema version. */
export function requireDesignFile(path: string): FileHeader {
	const header = readHeader(path);
	if (header.applicationId !== APPLICATION_ID) {
		throw new StoreError('NOT_A_DESIGN_FILE', `${path} is a database, but not a design file`);
	}
	return header;
}
