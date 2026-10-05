// A boolean preference kept in localStorage, so a toggle survives restarts. Storage can be absent
// or throw (private mode, tests); the flag then simply is not remembered.

export function readStoredFlag(key: string, fallback: boolean): boolean {
	try {
		const value = globalThis.localStorage.getItem(key);
		if (value === null) return fallback;
		return value === 'true';
	} catch {
		return fallback;
	}
}

export function writeStoredFlag(key: string, value: boolean): void {
	try {
		globalThis.localStorage.setItem(key, String(value));
	} catch {
		// not remembered
	}
}
