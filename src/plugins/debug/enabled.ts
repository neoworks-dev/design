// When the debug hook exists. It is for developers and for `bun run qa`, never for end users:
//
// - dev: the vite dev server (`import.meta.env.DEV`, also true in vitest),
// - QA session: main loads the app with `?qa=1` when it was started with `DESIGN_QA=1`
//   (electron/plugins/windows.ts). The renderer is a static build and cannot see main's
//   environment, so the query string is how that flag crosses over.
//
// A production build opened normally has neither, and the plugin installs nothing.

export interface DebugEnvironment {
	dev: boolean;
	/** `location.search`, for example `?qa=1`. */
	search: string;
}

export const QA_QUERY_PARAMETER = 'qa';

export function isDebugEnabled(environment: DebugEnvironment): boolean {
	if (environment.dev) return true;
	return new URLSearchParams(environment.search).get(QA_QUERY_PARAMETER) === '1';
}

export function currentEnvironment(): DebugEnvironment {
	let search = '';
	if (typeof location !== 'undefined') search = location.search;
	return { dev: import.meta.env.DEV, search };
}
