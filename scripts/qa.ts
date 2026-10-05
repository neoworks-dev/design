// Drive an isolated instance of the app on a virtual display over CDP.
// Usage: bun run qa <command> [...]; `bun run qa help` lists commands.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CdpSession } from './lib/cdp';
import {
	click,
	drag,
	holdModifiers,
	pressChord,
	scroll,
	typeText,
	type MouseButton
} from './lib/input';
import { formatElements, parsePoint, probeElements, resolveTarget } from './lib/probe';
import {
	mainLogPath,
	projectRoot,
	readRefs,
	readSession,
	requireSession,
	shotsDirectory,
	startSession,
	stopSession,
	writeRefs,
	writeSession
} from './lib/session';

const HELP = `qa — debug the app on a virtual display, driven over CDP

  start [--dev] [--build] [--fresh] [--no-viewer]
        --dev        vite dev server + HMR instead of the production build
        --build      rebuild before launching (build mode)
        --fresh      wipe the isolated profile (.qa/profile)
        --no-viewer  don't open vncviewer on the desktop
  stop                         app, dev server, display, viewer
  status                       session info and CDP endpoint

  probe [filter]               accessibility tree with refs (e12) and boxes
  screenshot <label> [--crop x,y,w,h]
  eval '<expression>'          runs in the renderer, awaited, printed as JSON
  logs [lines] [--renderer|--main]

  click <target>   dblclick <target>   rightclick <target>   (--modifiers Control,Alt,Shift)
  drag <from> <to> [--modifiers Control,Alt,Shift]
  type <text>                  inserts text into the focused element
  press <chord> [chord ...]    Escape, Control+z, Shift+Tab, v
  scroll <deltaY> [--at <target>]
  wait <name> [--gone] [--timeout ms]

  Every action accepts --screenshot <label> (taken on the same connection, so menus stay open).
  Targets: e12 (from probe) | at=x,y | css=<selector> | role=button:Save | an accessible name`;

type Handler = (cdp: CdpSession, args: string[]) => Promise<void>;

const ACTIONS: Record<string, Handler> = {
	probe: probeCommand,
	screenshot: screenshotCommand,
	eval: evalCommand,
	click: (cdp, args) => clickCommand(cdp, args, 'left', 1),
	dblclick: (cdp, args) => clickCommand(cdp, args, 'left', 2),
	rightclick: (cdp, args) => clickCommand(cdp, args, 'right', 1),
	drag: dragCommand,
	type: (cdp, args) => typeText(cdp, args.join(' ')),
	press: pressCommand,
	scroll: scrollCommand,
	wait: waitCommand
};

async function main(): Promise<void> {
	const [command = 'help', ...args] = process.argv.slice(2);
	if (command === 'help') {
		print(HELP);
		return;
	}
	if (command === 'start') return start(args);
	if (command === 'stop') return stop();
	if (command === 'status') return status();
	if (command === 'logs') return logs(args);

	const handler = ACTIONS[command];
	if (!handler) throw new Error(`unknown command "${command}"; see "bun run qa help"`);
	await withSession(async (cdp) => {
		const { rest, value: screenshotLabel } = takeOption(args, '--screenshot');
		await handler(cdp, rest);
		if (screenshotLabel) await saveScreenshot(cdp, screenshotLabel, undefined);
	});
}

async function start(args: string[]): Promise<void> {
	const session = await startSession({
		dev: args.includes('--dev'),
		build: args.includes('--build'),
		fresh: args.includes('--fresh'),
		viewer: !args.includes('--no-viewer')
	});
	printStatus();
	if (session.viewer) print(`watching: vncviewer ${session.display}`);
}

function stop(): void {
	const stopped = stopSession();
	print(stopped ? 'stopped' : 'no session');
}

function status(): void {
	const session = readSession();
	if (!session) {
		print('no session');
		return;
	}
	printStatus();
}

function printStatus(): void {
	const session = requireSession();
	print(`mode=${session.mode}  display=${session.display}  electron pid=${session.electronPid}`);
	print(`cdp: http://127.0.0.1:${session.cdpPort}  (targets: /json/list)`);
	if (session.devServerUrl) print(`dev server: ${session.devServerUrl}`);
	print(`logs: ${path.relative(projectRoot, mainLogPath)}`);
}

function logs(args: string[]): void {
	const lineCount = Number(args.find((arg) => /^\d+$/.test(arg)) || 80);
	let lines = readFileSync(mainLogPath, 'utf8').split('\n');
	if (args.includes('--renderer')) lines = lines.filter((line) => line.startsWith('[renderer'));
	if (args.includes('--main')) lines = lines.filter((line) => !line.startsWith('[renderer'));
	print(lines.slice(-lineCount).join('\n'));
}

async function withSession(work: (cdp: CdpSession) => Promise<void>): Promise<void> {
	const session = requireSession();
	const cdp = await CdpSession.connect(session.cdpPort);
	try {
		await work(cdp);
	} finally {
		cdp.close();
	}
}

async function probeCommand(cdp: CdpSession, args: string[]): Promise<void> {
	const header = await cdp.evaluate(`(() => {
		const debug = window.__design_debug;
		return {
			title: document.title,
			url: location.href,
			size: innerWidth + 'x' + innerHeight,
			focus: document.activeElement ? document.activeElement.tagName.toLowerCase() : 'none',
			summary: debug && typeof debug.summary === 'function' ? debug.summary() : null
		};
	})()`);
	const elements = await probeElements(cdp);
	writeRefs(Object.fromEntries(elements.map((element) => [element.ref, element.backendNodeId])));
	print(JSON.stringify(header));
	print(formatElements(elements, args[0]));
}

async function screenshotCommand(cdp: CdpSession, args: string[]): Promise<void> {
	const { rest, value: crop } = takeOption(args, '--crop');
	const label = rest[0] || 'screen';
	await saveScreenshot(cdp, label, crop);
}

async function saveScreenshot(
	cdp: CdpSession,
	label: string,
	crop: string | undefined
): Promise<void> {
	const session = requireSession();
	session.shotCounter += 1;
	writeSession(session);
	const params: Record<string, unknown> = { format: 'png' };
	if (crop) {
		const [x, y, width, height] = crop.split(',').map(Number);
		params.clip = { x, y, width, height, scale: 1 };
	}
	const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', params);
	const fileName = `${String(session.shotCounter).padStart(3, '0')}-${label}.png`;
	const filePath = path.join(shotsDirectory, fileName);
	writeFileSync(filePath, Buffer.from(data, 'base64'));
	print(`screenshot: ${path.relative(projectRoot, filePath)}`);
}

async function evalCommand(cdp: CdpSession, args: string[]): Promise<void> {
	const value = await cdp.evaluate(args.join(' '));
	print(JSON.stringify(value, null, 2));
}

async function clickCommand(
	cdp: CdpSession,
	args: string[],
	button: MouseButton,
	clickCount: number
): Promise<void> {
	const { rest, value: modifiers } = takeOption(args, '--modifiers');
	const point = await resolveTarget(cdp, requireArgument(rest, 0, 'target'), readRefs());
	holdModifiers(parseModifiers(modifiers));
	await click(cdp, point, button, clickCount);
	holdModifiers([]);
	print(`clicked ${point.x},${point.y}`);
}

function parseModifiers(value: string | undefined): string[] {
	if (value === undefined) return [];
	return value.split(',').filter((name) => name.length > 0);
}

async function dragCommand(cdp: CdpSession, args: string[]): Promise<void> {
	const refs = readRefs();
	const { rest, value: modifiers } = takeOption(args, '--modifiers');
	const from = await resolveTarget(cdp, requireArgument(rest, 0, 'from'), refs);
	const to = await resolveTarget(cdp, requireArgument(rest, 1, 'to'), refs);
	holdModifiers(parseModifiers(modifiers));
	await drag(cdp, from, to);
	holdModifiers([]);
	print(`dragged ${from.x},${from.y} -> ${to.x},${to.y}`);
}

async function pressCommand(cdp: CdpSession, args: string[]): Promise<void> {
	for (const chord of args) await pressChord(cdp, chord);
}

async function scrollCommand(cdp: CdpSession, args: string[]): Promise<void> {
	const { rest, value: at } = takeOption(args, '--at');
	const deltaY = Number(requireArgument(rest, 0, 'deltaY'));
	let point = parsePoint('720,450');
	if (at) point = await resolveTarget(cdp, at, readRefs());
	await scroll(cdp, point, deltaY);
}

async function waitCommand(cdp: CdpSession, args: string[]): Promise<void> {
	const { rest, value: timeoutText } = takeOption(args, '--timeout');
	const name = requireArgument(rest, 0, 'name');
	const wantGone = rest.includes('--gone');
	const deadline = Date.now() + Number(timeoutText || 10000);
	while (Date.now() < deadline) {
		const elements = await probeElements(cdp);
		const present = elements.some((element) => element.box && element.name.includes(name));
		if (present !== wantGone) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`timed out waiting for "${name}" to ${wantGone ? 'disappear' : 'appear'}`);
}

// Removes `--flag value` from args and returns the value separately.
function takeOption(args: string[], flag: string): { rest: string[]; value?: string } {
	const index = args.indexOf(flag);
	if (index === -1) return { rest: args };
	const rest = [...args.slice(0, index), ...args.slice(index + 2)];
	return { rest, value: args[index + 1] };
}

function requireArgument(args: string[], index: number, label: string): string {
	const value = args[index];
	if (value === undefined) throw new Error(`missing <${label}>`);
	return value;
}

function print(text: string): void {
	process.stdout.write(`${text}\n`);
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

main().catch((error: unknown) => {
	process.stderr.write(`${describeError(error)}\n`);
	process.exit(1);
});
