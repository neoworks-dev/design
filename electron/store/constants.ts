// The document file format in one place (data-model.md section 7, provisional until #2 is signed
// off): extension, MIME type, macOS UTI, SQLite magic, pragmas and retention. Nothing else in the
// codebase hard-codes these.

/** `.ndesign`, no leading dot (dialog filters want it that way). */
export const FILE_EXTENSION = 'ndesign';
export const FILE_MIME_TYPE = 'application/vnd.neoworks.design+sqlite';
export const FILE_UTI = 'dev.neoworks.design';
export const FILE_TYPE_NAME = 'Neoworks Design';

/** `PRAGMA application_id` marker: "NWDS". */
export const APPLICATION_ID = 0x4e574453;

/** Applied on every open, in this order. `foreign_keys` is per connection. */
export const OPEN_PRAGMAS = [
	'PRAGMA journal_mode = WAL',
	'PRAGMA synchronous = NORMAL',
	'PRAGMA foreign_keys = ON'
] as const;

/** The transaction log keeps at most this many rows ... */
export const TRANSACTION_LOG_MAX_ROWS = 1000;
/** ... and nothing older than this many days. */
export const TRANSACTION_LOG_MAX_AGE_DAYS = 30;

/** SQLite file header: byte offsets (https://www.sqlite.org/fileformat.html). */
export const SQLITE_HEADER_SIZE = 100;
export const SQLITE_MAGIC = 'SQLite format 3\u0000';
export const HEADER_OFFSET_USER_VERSION = 60;
export const HEADER_OFFSET_APPLICATION_ID = 68;
