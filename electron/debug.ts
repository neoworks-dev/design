import { app } from 'electron';

// Switches used by `bun run qa` (scripts/qa.ts) to run an isolated, observable instance.
// None of them are set in normal use.

const userDataDirectory = process.env.DESIGN_USER_DATA_DIR;
export const isQaSession = process.env.DESIGN_QA === '1';

// Must run before app `ready`: keeps a QA instance off the user's real profile.
export function applyDebugPaths(): void {
	if (!userDataDirectory) return;
	app.setPath('userData', userDataDirectory);
}
