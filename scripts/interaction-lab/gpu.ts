// The GPU lab: Figma (Chromium) and our app (Electron) on Hyprland headless outputs, so they
// render with the real GPU on a monitor nobody looks at. The virtual X displays of the normal lab
// only have SwiftShader, which says little about real frame times.
//
// Hyprland pieces (all reversed by `stopGpuLab`): headless outputs LABGPU and LABGPU2, placed far
// from the real monitors so the cursor cannot reach them, and a window rule that sends windows of
// class `interaction-lab` (Figma's Chromium) to LABGPU's workspace without focusing them.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { listTargets } from '../lib/cdp';
import { isRunning } from '../lib/virtualDisplay';
import { projectRoot } from '../lib/session';

// One output per app: a window alone on its monitor fills it, so both canvases get the same
// size; two windows on one output would be tiled to different sizes, and a hidden one gets no
// frame callbacks.
const FIGMA_OUTPUT = { name: 'LABGPU', workspace: '9', position: '10000x10000' };
const APP_OUTPUT = { name: 'LABGPU2', workspace: '10', position: '12000x10000' };
const WINDOW_CLASS = 'interaction-lab';
const FIGMA_PORT = 9225;
const APP_PORT = 9226;

const labDirectory = path.join(homedir(), '.cache/figma-lab');
const sessionPath = path.join(labDirectory, 'gpu-session.json');
const figmaProfile = path.join(labDirectory, 'profile-gpu');
const appProfile = path.join(projectRoot, '.qa-gpu/profile');
const userChromium = path.join(homedir(), '.config/chromium');
const LOGIN_FILES = [
	'Local State',
	'Default/Cookies',
	'Default/Network/Cookies',
	'Default/Preferences'
];

export interface GpuSession {
	figmaPid: number;
	figmaPort: number;
	appPid: number;
	appPort: number;
	figmaUrl: string;
	/** Set when the app runs alone on a real monitor (`gpu start --output`). */
	monitor?: RealMonitor;
}

/** A real monitor borrowed for a run: what it and the focus showed before, to put back. */
interface RealMonitor {
	name: string;
	previousWorkspace: string;
	focusedWorkspace: string;
}

export function readGpuSession(): GpuSession | null {
	if (!existsSync(sessionPath)) return null;
	const session: GpuSession = JSON.parse(readFileSync(sessionPath, 'utf8'));
	if (!isRunning(session.figmaPid) && !isRunning(session.appPid)) return null;
	return session;
}

export async function startGpuLab(figmaUrl: string): Promise<GpuSession> {
	const running = readGpuSession();
	if (running) return running;
	if (!existsSync(path.join(projectRoot, 'build/index.html'))) {
		throw new Error('no production build: run "bun run build" first');
	}
	prepareHyprland();
	copyLogin();
	const figmaPid = launch('chromium', [
		`--user-data-dir=${figmaProfile}`,
		`--remote-debugging-port=${FIGMA_PORT}`,
		...waylandWindowArguments(),
		'--no-first-run',
		'--no-default-browser-check',
		'--hide-crash-restore-bubble',
		figmaUrl
	]);
	const appPid = launchApp();
	const session: GpuSession = {
		figmaPid,
		figmaPort: FIGMA_PORT,
		appPid,
		appPort: APP_PORT,
		figmaUrl
	};
	writeFileSync(sessionPath, JSON.stringify(session, null, '\t'));
	await waitForPage(FIGMA_PORT, 'Figma');
	await waitForPage(APP_PORT, 'app');
	return session;
}

/**
 * Only the app, on the visible workspace of a real monitor (for example HDMI-A-1): real refresh
 * rate and resolution, but it takes that screen over until `gpu stop`. Figma's numbers come from
 * an earlier run, which also saves the memory of a second browser.
 */
export async function startAppOnMonitor(monitorName: string): Promise<GpuSession> {
	const running = readGpuSession();
	if (running) return running;
	if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) throw new Error('the GPU lab needs Hyprland');
	const monitor = borrowMonitor(monitorName);
	hyprland(
		`hl.workspace_rule({ workspace = "${APP_OUTPUT.workspace}", monitor = "${monitorName}" })`
	);
	const appPid = launchApp();
	const session: GpuSession = {
		figmaPid: 0,
		figmaPort: FIGMA_PORT,
		appPid,
		appPort: APP_PORT,
		figmaUrl: '',
		monitor
	};
	writeFileSync(sessionPath, JSON.stringify(session, null, '\t'));
	// A workspace that is not visible gets no frame callbacks, so it has to be shown.
	focusWorkspace(APP_OUTPUT.workspace);
	await waitForPage(APP_PORT, 'app');
	return session;
}

function borrowMonitor(name: string): RealMonitor {
	const monitors: Array<{ name: string; focused: boolean; activeWorkspace: { name: string } }> =
		JSON.parse(spawnSync('hyprctl', ['monitors', '-j'], { encoding: 'utf8' }).stdout);
	const monitor = monitors.find((candidate) => candidate.name === name);
	if (!monitor) throw new Error(`no monitor ${name}`);
	const focused = monitors.find((candidate) => candidate.focused);
	return {
		name,
		previousWorkspace: monitor.activeWorkspace.name,
		focusedWorkspace: (focused ?? monitor).activeWorkspace.name
	};
}

function focusWorkspace(workspace: string): void {
	hyprland(`hl.dispatch(hl.dsp.focus({ workspace = "${workspace}" }))`);
}

function returnMonitor(monitor: RealMonitor): void {
	focusWorkspace(monitor.previousWorkspace);
	focusWorkspace(monitor.focusedWorkspace);
}

export function stopGpuLab(): boolean {
	let stopped = false;
	if (existsSync(sessionPath)) {
		const session: GpuSession = JSON.parse(readFileSync(sessionPath, 'utf8'));
		killGroup(session.figmaPid);
		// Started by Hyprland, so it leads no process group of ours: end the process itself.
		killProcess(session.appPid);
		if (session.monitor) returnMonitor(session.monitor);
		rmSync(sessionPath, { force: true });
		stopped = true;
	}
	hyprland(
		`hl.window_rule({ name = "${WINDOW_CLASS}", enabled = false, match = { class = "^(${WINDOW_CLASS})$" } })`
	);
	for (const output of [FIGMA_OUTPUT, APP_OUTPUT]) {
		if (!hasOutput(output.name)) continue;
		spawnSync('hyprctl', ['output', 'remove', output.name], { stdio: 'ignore' });
		stopped = true;
	}
	return stopped;
}

function prepareHyprland(): void {
	if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) throw new Error('the GPU lab needs Hyprland');
	for (const output of [FIGMA_OUTPUT, APP_OUTPUT]) createOutput(output);
	hyprland(
		`hl.window_rule({ name = "${WINDOW_CLASS}", match = { class = "^(${WINDOW_CLASS})$" }, workspace = "${FIGMA_OUTPUT.workspace} silent", no_initial_focus = true })`
	);
}

function createOutput(output: { name: string; workspace: string; position: string }): void {
	if (!hasOutput(output.name)) {
		spawnSync('hyprctl', ['output', 'create', 'headless', output.name], { stdio: 'ignore' });
	}
	// Same size as the virtual displays; far from the real monitors so the cursor never gets there.
	hyprland(
		`hl.monitor({ output = "${output.name}", mode = "1440x900@60", position = "${output.position}", scale = 1.0 })`
	);
	hyprland(`hl.workspace_rule({ workspace = "${output.workspace}", monitor = "${output.name}" })`);
}

function hasOutput(name: string): boolean {
	const monitors = spawnSync('hyprctl', ['monitors'], { encoding: 'utf8' });
	return monitors.stdout.includes(`Monitor ${name} `);
}

function hyprland(lua: string): void {
	const result = spawnSync('hyprctl', ['eval', lua], { encoding: 'utf8' });
	if (!result.stdout.includes('ok'))
		throw new Error(`hyprctl eval failed: ${result.stdout.trim()}`);
}

function waylandWindowArguments(): string[] {
	return ['--ozone-platform=wayland', `--class=${WINDOW_CLASS}`, '--window-size=1440,900'];
}

// Electron ignores --class on Wayland (its app_id stays "draftboard", like the user's own
// instance), so the class rule cannot place it. Hyprland launches it instead, with exec rules
// that apply to the launched process's windows before they map. The binary is started directly
// (no Node wrapper) so the window belongs to the launched pid.
function launchApp(): number {
	mkdirSync(path.join(appProfile, 'library'), { recursive: true });
	const electron = path.join(projectRoot, 'node_modules/electron/dist/electron');
	const environment = [
		'DESIGN_QA=1',
		`DESIGN_USER_DATA_DIR=${quote(appProfile)}`,
		`DRAFTBOARD_LIBRARY_DIR=${quote(path.join(appProfile, 'library'))}`
	].join(' ');
	const command = `cd ${quote(projectRoot)} && exec env ${environment} ${quote(electron)} . --remote-debugging-port=${APP_PORT} --ozone-platform=wayland`;
	hyprland(
		`hl.exec_cmd(${JSON.stringify(command)}, { workspace = "${APP_OUTPUT.workspace} silent", no_initial_focus = true })`
	);
	return waitForPid(`--remote-debugging-port=${APP_PORT}`);
}

function quote(text: string): string {
	return `'${text.replace(/'/g, "'\\''")}'`;
}

// Hyprland is the parent, so the pid comes from the process table: the oldest match is the
// browser process (Electron reorders its arguments, so match on the flag alone).
function waitForPid(argument: string): number {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const found = spawnSync('pgrep', ['-o', '-f', `electron/dist/electron ${argument}`], {
			encoding: 'utf8'
		});
		const pid = Number(found.stdout.trim());
		if (pid > 0) return pid;
		spawnSync('sleep', ['0.2']);
	}
	throw new Error('the app did not start');
}

function launch(
	command: string,
	args: string[],
	extraEnvironment: Record<string, string> = {}
): number {
	const child = spawn(command, args, {
		cwd: projectRoot,
		env: { ...process.env, ...extraEnvironment, DISPLAY: undefined },
		stdio: 'ignore',
		detached: true
	});
	child.unref();
	if (!child.pid) throw new Error(`${command} did not start`);
	return child.pid;
}

function copyLogin(): void {
	if (existsSync(path.join(figmaProfile, 'Local State'))) return;
	mkdirSync(path.join(figmaProfile, 'Default/Network'), { recursive: true });
	for (const relative of LOGIN_FILES) {
		const source = path.join(userChromium, relative);
		if (existsSync(source)) copyFileSync(source, path.join(figmaProfile, relative));
	}
}

async function waitForPage(port: number, label: string): Promise<void> {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		const targets = await listTargets(port).catch(() => []);
		if (targets.some((target) => target.type === 'page')) return;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(`${label} did not open on port ${port} within 90 s`);
}

function killProcess(pid: number): void {
	if (pid <= 0) return;
	try {
		process.kill(pid, 'SIGTERM');
	} catch {
		// Already gone.
	}
}

function killGroup(pid: number): void {
	if (pid <= 0) return;
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		// Already gone.
	}
}
