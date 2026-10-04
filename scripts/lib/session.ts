import { spawn, spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { CdpSession, isAppPage, listTargets } from './cdp';
import {
	displayEnvironment,
	isRunning,
	openViewer,
	startVirtualDisplay,
	stopVirtualDisplay
} from './virtualDisplay';

export const projectRoot = path.resolve(import.meta.dirname, '../..');
export const qaDirectory = path.join(projectRoot, '.qa');
export const shotsDirectory = path.join(qaDirectory, 'shots');
export const mainLogPath = path.join(qaDirectory, 'main.log');
const viteLogPath = path.join(qaDirectory, 'vite.log');
const profileDirectory = path.join(qaDirectory, 'profile');
const sessionPath = path.join(qaDirectory, 'session.json');
const refsPath = path.join(qaDirectory, 'refs.json');

export interface Session {
	mode: 'build' | 'dev';
	display: string;
	displayPid: number;
	electronPid: number;
	devServerPid: number;
	devServerUrl: string;
	cdpPort: number;
	viewer: boolean;
	shotCounter: number;
}

export interface StartOptions {
	dev: boolean;
	build: boolean;
	fresh: boolean;
	viewer: boolean;
}

export function readSession(): Session | null {
	if (!existsSync(sessionPath)) return null;
	const session: Session = JSON.parse(readFileSync(sessionPath, 'utf8'));
	return session;
}

export function writeSession(session: Session): void {
	writeFileSync(sessionPath, `${JSON.stringify(session, null, '\t')}\n`);
}

export function requireSession(): Session {
	const session = readSession();
	if (!session || !isRunning(session.electronPid)) {
		throw new Error('no running session; start one with "bun run qa start"');
	}
	return session;
}

export function readRefs(): Record<string, number> {
	if (!existsSync(refsPath)) return {};
	const refs: Record<string, number> = JSON.parse(readFileSync(refsPath, 'utf8'));
	return refs;
}

export function writeRefs(refs: Record<string, number>): void {
	writeFileSync(refsPath, JSON.stringify(refs));
}

export async function startSession(options: StartOptions): Promise<Session> {
	const existing = readSession();
	if (existing && isRunning(existing.electronPid)) {
		throw new Error('a session is already running; "bun run qa stop" first');
	}
	prepareDirectories(options.fresh);
	compile(options);

	const devServer = options.dev ? await startDevServer() : { pid: 0, url: '' };
	const display = await startVirtualDisplay();
	if (!display) throw new Error('no virtual display: install tigervnc (Xvnc) or xorg-server-xvfb');
	const viewer = options.viewer && openViewer(display);

	const cdpPort = await freePort();
	const electronPid = launchElectron(display.display, cdpPort, devServer.url);
	const session: Session = {
		mode: options.dev ? 'dev' : 'build',
		display: display.display,
		displayPid: display.pid,
		electronPid,
		devServerPid: devServer.pid,
		devServerUrl: devServer.url,
		cdpPort,
		viewer,
		shotCounter: 0
	};
	writeSession(session);
	await waitForAppPage(session);
	return session;
}

export function stopSession(): boolean {
	const session = readSession();
	if (!session) return false;
	killGroup(session.electronPid);
	killGroup(session.devServerPid);
	stopVirtualDisplay(session.display, session.displayPid);
	rmSync(sessionPath, { force: true });
	rmSync(refsPath, { force: true });
	return true;
}

function prepareDirectories(fresh: boolean): void {
	if (fresh) rmSync(profileDirectory, { recursive: true, force: true });
	mkdirSync(shotsDirectory, { recursive: true });
	mkdirSync(profileDirectory, { recursive: true });
}

function compile(options: StartOptions): void {
	if (!options.dev && (options.build || isBuildStale())) {
		run('bun', ['run', 'build']);
		return;
	}
	run('bun', ['run', 'electron:compile']);
}

// A build older than any renderer or main source would launch yesterday's app.
function isBuildStale(): boolean {
	const buildIndex = path.join(projectRoot, 'build/index.html');
	if (!existsSync(buildIndex)) return true;
	const builtAt = statSync(buildIndex).mtimeMs;
	const sourceRoots = ['src', 'electron', 'static'].map((name) => path.join(projectRoot, name));
	return sourceRoots.some((root) => newestModification(root) > builtAt);
}

function newestModification(directory: string): number {
	if (!existsSync(directory)) return 0;
	let newest = 0;
	for (const entry of readdirSync(directory, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile() || entry.parentPath.includes(`${path.sep}dist`)) continue;
		newest = Math.max(newest, statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
	}
	return newest;
}

function run(command: string, args: string[]): void {
	const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' });
	if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

async function startDevServer(): Promise<{ pid: number; url: string }> {
	const port = await freePort();
	const log = openSync(viteLogPath, 'w');
	const child = spawn(
		'bun',
		['run', 'dev', '--', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
		{ cwd: projectRoot, stdio: ['ignore', log, log], detached: true }
	);
	child.unref();
	const url = `http://127.0.0.1:${port}`;
	const ready = await poll(async () => (await fetch(url)).ok, 60);
	if (!ready) throw new Error(`vite dev server did not come up; see ${viteLogPath}`);
	return { pid: child.pid ?? 0, url };
}

function launchElectron(display: string, cdpPort: number, devServerUrl: string): number {
	const log = openSync(mainLogPath, 'w');
	const environment: Record<string, string | undefined> = {
		...process.env,
		...displayEnvironment(display),
		WAYLAND_DISPLAY: undefined,
		DESIGN_QA: '1',
		DESIGN_USER_DATA_DIR: profileDirectory,
		DEV_SERVER_URL: devServerUrl || undefined
	};
	const electron = path.join(projectRoot, 'node_modules/.bin/electron');
	// No GPU driver works on the virtual display; SwiftShader gives CanvasKit a (software) WebGL2.
	const args = [
		'.',
		`--remote-debugging-port=${cdpPort}`,
		'--ozone-platform=x11',
		'--use-angle=swiftshader',
		'--enable-unsafe-swiftshader'
	];
	const child = spawn(electron, args, {
		cwd: projectRoot,
		env: environment,
		stdio: ['ignore', log, log],
		detached: true
	});
	child.unref();
	return child.pid ?? 0;
}

async function waitForAppPage(session: Session): Promise<void> {
	const ready = await poll(async () => {
		const targets = await listTargets(session.cdpPort);
		return targets.some((target) => isAppPage(target) && target.url !== 'about:blank');
	}, 60);
	if (!ready) throw new Error(`app window never appeared; see ${mainLogPath}`);
	await waitForBoot(session);
}

// The renderer sets <html data-ready="true"> once booted.
async function waitForBoot(session: Session): Promise<void> {
	const cdp = await CdpSession.connect(session.cdpPort);
	try {
		const booted = await poll(
			async () => (await cdp.evaluate('document.documentElement.dataset.ready')) === 'true',
			60
		);
		if (!booted) throw new Error(`app never signalled ready; see ${mainLogPath} ("qa logs")`);
	} finally {
		cdp.close();
	}
}

// Retries `check` every 500ms; exceptions count as "not yet".
async function poll(check: () => Promise<boolean>, attempts: number): Promise<boolean> {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			if (await check()) return true;
		} catch {
			// Not up yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

// Children were spawned detached, so each leads its own process group.
function killGroup(pid: number): void {
	if (pid <= 0) return;
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		// Already gone.
	}
}
