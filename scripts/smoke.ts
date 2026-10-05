// Smoke test of a packaged build (#140): start the executable electron-builder produced, wait for
// the renderer to finish booting and check that nothing failed. Used by the CI packaging job and
// by hand after `bun run package:dir`.
//
// Usage: bun run smoke [path-to-executable] [--timeout <ms>] [--screenshot <png>] [--open <file.ndesign>]
//
// The app runs with an empty temporary profile and `--remote-debugging-port`, the same way
// `bun run qa` drives a development build (scripts/lib/cdp.ts). On Linux without a DISPLAY it
// starts its own virtual display. Exit code 0 means: window loaded from `app://`, renderer set
// `data-ready`, the main kernel booted without failures, no plugin failed or is stuck pending.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CdpSession } from './lib/cdp';
import { startVirtualDisplay, stopVirtualDisplay, type VirtualDisplay } from './lib/virtualDisplay';

const projectRoot = path.resolve(import.meta.dirname, '..');
const DEFAULT_TIMEOUT_MS = 90_000;

interface Options {
	executable: string;
	timeoutMs: number;
	screenshot: string | null;
	/** A design file to pass on the command line, as a double click in the file manager does. */
	openFile: string | null;
}

function defaultExecutable(): string {
	const release = path.join(projectRoot, 'release');
	if (process.platform === 'darwin') {
		return path.join(release, 'mac-arm64/Draftboard.app/Contents/MacOS/Draftboard');
	}
	if (process.platform === 'win32') return path.join(release, 'win-unpacked/Draftboard.exe');
	return path.join(release, 'linux-unpacked/draftboard');
}

function parseArguments(args: string[]): Options {
	let executable = defaultExecutable();
	let timeoutMs = DEFAULT_TIMEOUT_MS;
	let screenshot: string | null = null;
	let openFile: string | null = null;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === '--timeout') {
			timeoutMs = Number(args[index + 1]);
			index += 1;
			continue;
		}
		if (args[index] === '--screenshot') {
			screenshot = path.resolve(args[index + 1]);
			index += 1;
			continue;
		}
		if (args[index] === '--open') {
			openFile = path.resolve(args[index + 1]);
			index += 1;
			continue;
		}
		executable = path.resolve(args[index]);
	}
	return { executable, timeoutMs, screenshot, openFile };
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close();
			if (address === null || typeof address === 'string') {
				reject(new Error('no port'));
				return;
			}
			resolve(address.port);
		});
	});
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function connect(port: number, deadline: number): Promise<CdpSession> {
	let lastError: unknown = new Error('never tried');
	while (Date.now() < deadline) {
		try {
			return await CdpSession.connect(port);
		} catch (error) {
			lastError = error;
			await sleep(500);
		}
	}
	throw new Error(`the app never opened a window: ${String(lastError)}`);
}

async function waitForReady(session: CdpSession, deadline: number): Promise<void> {
	while (Date.now() < deadline) {
		const ready = await session.evaluate('document.documentElement.dataset.ready === "true"');
		if (ready === true) return;
		await sleep(500);
	}
	throw new Error('the renderer did not finish booting (data-ready was never set)');
}

interface Findings {
	url: string;
	version: string;
	hasBridge: boolean;
	canvasCount: number;
	mainFailures: unknown[];
	errorDialogOpen: boolean;
	bodyText: string;
}

const INSPECT = `(async () => {
	const report = await window.desktop.app.bootReport();
	return {
		url: location.href,
		version: await window.desktop.app.version(),
		hasBridge: typeof window.desktop === 'object',
		canvasCount: document.querySelectorAll('canvas').length,
		mainFailures: report === null ? ['main boot report missing'] : report.failed.concat(report.pending),
		errorDialogOpen: document.querySelector('[data-error-ui-dialog]') !== null,
		bodyText: document.body.innerText.slice(0, 200)
	};
})()`;

function problemsIn(findings: Findings): string[] {
	const problems: string[] = [];
	if (!findings.url.startsWith('app://design/')) problems.push(`unexpected url ${findings.url}`);
	if (!findings.hasBridge) problems.push('the preload bridge is missing');
	if (findings.canvasCount === 0)
		problems.push('no canvas on the page: the renderer did not start');
	if (findings.mainFailures.length > 0) {
		problems.push(`main plugins failed or pending: ${JSON.stringify(findings.mainFailures)}`);
	}
	if (findings.errorDialogOpen) problems.push('the plugin status dialog opened: a plugin failed');
	return problems;
}

/** An opened file lands in the recent list; wait until it shows up there. */
async function waitForDocument(session: CdpSession, file: string, deadline: number): Promise<void> {
	const expression = `window.desktop.files.recent().then((recent) => recent.some((entry) => entry.path === ${JSON.stringify(file)}))`;
	while (Date.now() < deadline) {
		if ((await session.evaluate(expression)) === true) return;
		await sleep(500);
	}
	throw new Error(`the file ${file} was not opened (it never reached the recent list)`);
}

async function saveScreenshot(session: CdpSession, file: string): Promise<void> {
	const shot = await session.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
	writeFileSync(file, Buffer.from(shot.data, 'base64'));
	process.stdout.write(`smoke: screenshot ${file}\n`);
}

async function run(options: Options, display: VirtualDisplay | null): Promise<string[]> {
	const profile = mkdtempSync(path.join(tmpdir(), 'design-smoke-'));
	const port = await freePort();
	const environment: Record<string, string | undefined> = {
		...process.env,
		DESIGN_USER_DATA_DIR: profile,
		DRAFTBOARD_LIBRARY_DIR: path.join(profile, 'library'),
		// An AppImage normally mounts itself through FUSE, which CI machines do not have.
		APPIMAGE_EXTRACT_AND_RUN: '1'
	};
	if (display !== null) environment.DISPLAY = display.display;
	delete environment.WAYLAND_DISPLAY;
	const args = [
		`--remote-debugging-port=${port}`,
		// CI containers have no setuid chrome-sandbox helper, and no GPU.
		'--no-sandbox',
		'--use-angle=swiftshader',
		'--enable-unsafe-swiftshader'
	];
	if (process.platform === 'linux') args.push('--ozone-platform=x11');
	if (options.openFile !== null) args.push(options.openFile);
	const child: ChildProcess = spawn(options.executable, args, {
		env: environment,
		stdio: ['ignore', 'inherit', 'inherit']
	});
	const deadline = Date.now() + options.timeoutMs;
	try {
		const session = await connect(port, deadline);
		try {
			await waitForReady(session, deadline);
			if (options.openFile !== null) await waitForDocument(session, options.openFile, deadline);
			const findings = (await session.evaluate(INSPECT)) as Findings;
			if (options.screenshot !== null) await saveScreenshot(session, options.screenshot);
			process.stdout.write(`smoke: app ${findings.version} ready at ${findings.url}\n`);
			return problemsIn(findings);
		} finally {
			session.close();
		}
	} finally {
		child.kill('SIGTERM');
		await sleep(500);
		child.kill('SIGKILL');
		rmSync(profile, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const options = parseArguments(process.argv.slice(2));
	if (!existsSync(options.executable)) {
		throw new Error(`no executable at ${options.executable}; run bun run package:dir first`);
	}
	let display: VirtualDisplay | null = null;
	if (process.platform === 'linux' && !process.env.DISPLAY) {
		display = await startVirtualDisplay();
		if (display === null) throw new Error('no DISPLAY and no Xvnc/Xvfb to start one');
	}
	try {
		const problems = await run(options, display);
		if (problems.length > 0) {
			process.stderr.write(`smoke FAILED:\n- ${problems.join('\n- ')}\n`);
			process.exitCode = 1;
			return;
		}
		process.stdout.write('smoke: ok\n');
	} finally {
		if (display !== null) stopVirtualDisplay(display.display, display.pid);
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`smoke FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
