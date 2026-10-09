// The slice of Bun's built-in SQLite driver the scripts use (no bun-types in this project).
declare module 'bun:sqlite' {
	export interface Statement<Row = unknown> {
		all(...parameters: unknown[]): Row[];
		get(...parameters: unknown[]): Row | null;
	}

	export class Database {
		constructor(file: string, options?: { readonly?: boolean });
		query<Row = unknown>(sql: string): Statement<Row>;
		close(): void;
	}
}
