// `bun run electron:dev`: starts the vite dev server in this process, then opens Electron against
// it. Vite picks the next free port if 5173 is taken, so the URL comes from the running server.
// Closing the window stops vite; Ctrl+C stops both.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function localUrl(urls: string[] | undefined): string {
	if (urls === undefined || urls.length === 0) {
		throw new Error('vite dev server reported no local URL');
	}
	return urls[0];
}

const server = await createServer({ root: projectRoot });
await server.listen();
server.printUrls();
const devServerUrl = localUrl(server.resolvedUrls?.local);

const electron = spawn(path.join(projectRoot, 'node_modules/.bin/electron'), ['.'], {
	cwd: projectRoot,
	stdio: 'inherit',
	env: { ...process.env, DEV_SERVER_URL: devServerUrl }
});

const stopElectron = (): void => {
	electron.kill('SIGTERM');
};
process.on('SIGINT', stopElectron);
process.on('SIGTERM', stopElectron);

electron.on('exit', (code) => {
	void server.close().then(() => process.exit(code ?? 0));
});
