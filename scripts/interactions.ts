// Interaction experiments that run identically against Figma and our app, and compare them.
// Usage: bun run interactions <command>; `bun run interactions help` lists commands.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CdpSession, listTargets } from './lib/cdp';
import { projectRoot } from './lib/session';
import { readBrowserSession, startBrowser, stopBrowser } from './interaction-lab/browser';
import { readGpuSession, startAppOnMonitor, startGpuLab, stopGpuLab } from './interaction-lab/gpu';
import {
	compareResults,
	readBaseline,
	writeComparisonRows,
	writeParitySummary,
	renderComparison,
	writeBaseline,
	type ComparisonRow
} from './interaction-lab/compare';
import { FIGMA_BUILDER, readSubtree } from './interaction-lab/copyToFigma';
import { experiments } from './interaction-lab/experiments';
import { Lab, prepareOutputDirectory, type Experiment, type Result } from './interaction-lab/lab';
import { writePerformanceSummary } from './interaction-lab/performance';
import { writeReport } from './interaction-lab/report';
import {
	isFigmaFile,
	TARGET_NAMES,
	useGpuLab,
	targetByName,
	type Target,
	type TargetName
} from './interaction-lab/targets';

const USER_CHROMIUM_PORT = 9222;

const HELP = `interactions — the same interaction experiments against Figma and our app, compared

Each experiment drives a target with real CDP mouse/key input on a "CDP lab" page holding a
standard fixture, samples the selection after every event, and records named measurements.
Figma's measurements are saved as baselines (scripts/interaction-lab/baselines/figma/, committed);
the app's are compared against them.

Targets
  figma   the lab browser: Chromium on a virtual display, logged in with a copy of your cookies
          (or FIGMA_CDP_PORT, e.g. your own Chromium with --remote-debugging-port=${USER_CHROMIUM_PORT})
  app     the running QA session; use a build ("bun run qa start --build"), since a --dev session
          reloads whenever a source file changes and that voids a run

Add --gpu to any command to use the GPU lab instead: both apps on a Hyprland headless output
with real GPU rendering ("gpu start" / "gpu stop"; the virtual displays only have SwiftShader).

Commands
  gpu start [--url <figma file url>] [--output <monitor>] | gpu stop | gpu status
  list                               experiments and their questions
  run <name ...|all> [--target figma|app|both]
                                     run (default both); figma refreshes the baseline, app is
                                     compared against it. Output: docs/references/interaction-lab/
                                     <name>/{figma,app}/ (report.md, samples.json, screenshots)
                                     and <name>/comparison.md
  check [name ...|all]               app only, against the committed baselines; exits 1 on any
                                     mismatch (no Figma needed)
  perf [name ...] [--target figma|app|both] [--count 5000] [--profile] [--skip stage,...]
                                     performance experiments (grid of squares): frame times, input→
                                     frame latency, time to interaction; side by side with the
                                     app/Figma ratio in docs/research/performance-parity.md;
                                     --skip leaves out stages (performance-grid: drag-all)
  state [--target figma|app]         selection, viewport and canvas geometry of a target
  browser start [--url <figma file url>] [--refresh-login] [--no-viewer]
  browser stop | browser status      the Figma lab browser (watch it with vncviewer)
  dump-sources <directory>           every JS / wasm script the Figma tab parsed, plus index.json
  copy-to-figma <file.ndesign> <node name> [--page <name>]
                                     rebuild a node subtree from one of our files in the open
                                     Figma file, on its own page (default "<node name> repro"),
                                     to try a setup by hand in Figma

Experiments live in scripts/interaction-lab/experiments/ (register new ones in index.ts). They may
only use the Lab API, never a target's own API, so both targets run the exact same steps.`;

const outputRoot = path.join(projectRoot, 'docs/references/interaction-lab');

interface RunOutcome {
	results: Result[];
	error: string | null;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	useGpuLab(argv.includes('--gpu'));
	const [command = 'help', ...args] = argv.filter((arg) => arg !== '--gpu');
	if (command === 'help') return print(HELP);
	if (command === 'list') return listExperiments();
	if (command === 'run') return runCommand(args);
	if (command === 'check') return checkCommand(args);
	if (command === 'perf') return perfCommand(args);
	if (command === 'gpu') return gpuCommand(args);
	if (command === 'state') return stateCommand(args);
	if (command === 'browser') return browserCommand(args);
	if (command === 'dump-sources') return dumpSources(args);
	if (command === 'copy-to-figma') return copyToFigma(args);
	throw new Error(`unknown command "${command}"; see "bun run interactions help"`);
}

function listExperiments(): void {
	for (const experiment of experiments) print(`${experiment.name}\n    ${experiment.question}`);
}

async function runCommand(args: string[]): Promise<void> {
	const { rest, value } = takeOption(args, '--target');
	const targets = parseTargets(value);
	let mismatches = 0;
	for (const experiment of selectExperiments(rest)) {
		if (targets.includes('figma')) await runAndRecordFigma(experiment);
		if (targets.includes('app')) mismatches += await runAndCompareApp(experiment);
	}
	if (targets.includes('app')) print(`\n${mismatches} measurement(s) differ from Figma`);
}

async function checkCommand(args: string[]): Promise<void> {
	let mismatches = 0;
	const names = args;
	if (names.length === 0) names.push('all');
	for (const experiment of selectExperiments(names))
		mismatches += await runAndCompareApp(experiment);
	if (mismatches === 0) return print('\nall measurements match Figma');
	print(`\n${mismatches} measurement(s) differ from Figma`);
	process.exitCode = 1;
}

function parseTargets(value: string | undefined): TargetName[] {
	if (value === undefined || value === 'both') return TARGET_NAMES;
	return [targetByName(value).name];
}

async function runAndRecordFigma(experiment: Experiment): Promise<void> {
	const outcome = await runOnTarget(experiment, targetByName('figma'));
	if (outcome.error) {
		print(`✗ figma ${experiment.name}: ${outcome.error} (baseline kept)`);
		return;
	}
	writeBaseline(experiment, outcome.results);
	print(`✓ figma ${experiment.name}: ${outcome.results.length} measurements → baseline`);
}

/** Runs the app and writes comparison.md; returns the number of mismatching measurements. */
async function runAndCompareApp(experiment: Experiment): Promise<number> {
	const baseline = readBaseline(experiment.name);
	const outcome = await runOnTarget(experiment, targetByName('app'));
	if (!baseline) {
		print(`? app ${experiment.name}: no Figma baseline yet (run with --target figma)`);
		return 0;
	}
	const rows = compareResults(baseline.results, outcome.results);
	const comparisonFile = path.join(outputRoot, experiment.name, 'comparison.md');
	writeFileSync(comparisonFile, renderComparison(experiment, baseline, rows, outcome.error));
	writeComparisonRows(experiment.name, rows, outcome.error);
	writeParitySummary(experiments);
	printComparison(experiment, rows, outcome.error, comparisonFile);
	return rows.filter((row) => !row.matches).length;
}

function printComparison(
	experiment: Experiment,
	rows: ComparisonRow[],
	error: string | null,
	comparisonFile: string
): void {
	const mismatches = rows.filter((row) => !row.matches);
	const relative = path.relative(projectRoot, comparisonFile);
	let mark = '✓';
	if (mismatches.length > 0 || error) mark = '✗';
	print(
		`${mark} app ${experiment.name}: ${rows.length - mismatches.length}/${rows.length} match  (${relative})`
	);
	if (error) print(`    run failed: ${error}`);
	for (const row of mismatches) {
		print(`    ${row.key}\n        figma: ${String(row.figma)}\n        app:   ${String(row.app)}`);
	}
}

// A page reload mid-run (Vite HMR in a --dev QA session) voids the run; it is retried once.
async function runOnTarget(experiment: Experiment, target: Target): Promise<RunOutcome> {
	const outcome = await runOnTargetOnce(experiment, target);
	if (!outcome.reloaded) return outcome;
	print(`  ${target.name} reloaded during ${experiment.name}; running it again`);
	return runOnTargetOnce(experiment, target);
}

async function runOnTargetOnce(
	experiment: Experiment,
	target: Target
): Promise<RunOutcome & { reloaded: boolean }> {
	const outputDirectory = path.join(outputRoot, experiment.name, target.name);
	prepareOutputDirectory(outputDirectory);
	const lab = await Lab.connect(target, outputDirectory);
	const startedAt = new Date();
	let error: string | null = null;
	try {
		const file = await lab.evaluate<string>('__interactionLab.state().file');
		try {
			await lab.resetToFixture();
			await lab.shot('fixture');
			await experiment.run(lab);
		} catch (caught) {
			error = describeError(caught);
			await lab.shot('failure');
		}
		if (lab.reloaded) error = `the page reloaded during the run (${String(error)})`;
		await lab.releaseEverything();
		writeReport(lab, { experiment, target: target.name, startedAt, file, error });
	} finally {
		lab.close();
	}
	return { results: lab.results, error, reloaded: lab.reloaded };
}

function selectExperiments(names: string[]): Experiment[] {
	if (names.length === 0) {
		throw new Error('name an experiment or "all"; see "bun run interactions list"');
	}
	if (names.includes('all')) return experiments.filter((experiment) => !isPerformance(experiment));
	return names.map((name) => {
		const experiment = experiments.find((candidate) => candidate.name === name);
		if (!experiment) throw new Error(`unknown experiment "${name}"`);
		return experiment;
	});
}

function isPerformance(experiment: Experiment): boolean {
	return experiment.kind === 'performance';
}

async function perfCommand(args: string[]): Promise<void> {
	const { rest: withoutSkip, value: skip } = takeOption(args, '--skip');
	if (skip) process.env.PERF_SKIP = skip;
	const { rest: withoutCount, value: count } = takeOption(withoutSkip, '--count');
	if (count) process.env.PERF_COUNT = count;
	if (withoutCount.includes('--profile')) process.env.PERF_PROFILE = '1';
	const { rest: withProfileFlag, value } = takeOption(withoutCount, '--target');
	const rest = withProfileFlag.filter((arg) => arg !== '--profile');
	const targets = parseTargets(value);
	const performanceExperiments = experiments.filter(isPerformance);
	let selected = performanceExperiments;
	if (rest.length > 0 && !rest.includes('all')) {
		selected = performanceExperiments.filter((experiment) => rest.includes(experiment.name));
	}
	for (const experiment of selected) {
		for (const name of targets) {
			const outcome = await runOnTarget(experiment, targetByName(name));
			let line = `✓ ${name} ${experiment.name}`;
			if (outcome.error) line = `✗ ${name} ${experiment.name}: ${outcome.error}`;
			print(line);
			for (const result of outcome.results) print(`    ${result.key}: ${result.value}`);
		}
	}
	writePerformanceSummary(outputRoot, performanceExperiments, await describeEnvironment(targets));
	print(
		`\nsummary: ${path.relative(projectRoot, path.join(projectRoot, 'docs/research/performance-parity.md'))}`
	);
}

const RENDERER_PROBE = `(() => {
	const gl = document.createElement('canvas').getContext('webgl2');
	if (!gl) return 'no WebGL2';
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	if (!info) return gl.getParameter(gl.RENDERER);
	return gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
})()`;

/** Where the run happened and which WebGL renderer each target got (GPU or SwiftShader). */
async function describeEnvironment(targets: TargetName[]): Promise<string> {
	let place = 'virtual X displays (Xvnc), software WebGL expected';
	if (readGpuSession() && process.argv.includes('--gpu'))
		place = 'GPU lab (Hyprland headless outputs, 1440×900)';
	const renderers: string[] = [];
	for (const name of targets) {
		const target = targetByName(name);
		const cdp = await CdpSession.connect(target.port(), target.matches);
		try {
			renderers.push(`${name}: ${String(await cdp.evaluate(RENDERER_PROBE))}`);
		} finally {
			cdp.close();
		}
	}
	return `${place}; ${renderers.join('; ')}`;
}

async function stateCommand(args: string[]): Promise<void> {
	const { value } = takeOption(args, '--target');
	const target = targetByName(value || 'app');
	const lab = await Lab.connect(target, outputRoot);
	try {
		print(JSON.stringify(await lab.evaluate('__interactionLab.state()'), null, 2));
	} finally {
		lab.close();
	}
}

async function browserCommand(args: string[]): Promise<void> {
	const [action = 'status', ...rest] = args;
	if (action === 'stop') {
		let message = 'no lab browser';
		if (stopBrowser()) message = 'stopped';
		return print(message);
	}
	if (action === 'status') {
		const session = readBrowserSession();
		if (!session) return print('no lab browser');
		print(`display ${session.display} (vncviewer ${session.display}), CDP port ${session.port}`);
		return print(session.url);
	}
	if (action !== 'start') throw new Error(`unknown browser action "${action}"`);
	const session = await startBrowser({
		url: await figmaFileUrl(takeOption(rest, '--url').value),
		refreshLogin: rest.includes('--refresh-login'),
		viewer: !rest.includes('--no-viewer')
	});
	print(`lab browser on ${session.display}, CDP port ${session.port}: ${session.url}`);
}

async function gpuCommand(args: string[]): Promise<void> {
	const [action = 'status', ...rest] = args;
	if (action === 'stop') {
		let message = 'no GPU lab';
		if (stopGpuLab()) message = 'GPU lab stopped, LABGPU output removed';
		return print(message);
	}
	if (action === 'status') {
		const session = readGpuSession();
		if (!session) return print('no GPU lab');
		return print(
			`Figma on CDP port ${session.figmaPort}, app on ${session.appPort} (Hyprland output LABGPU)`
		);
	}
	if (action !== 'start') throw new Error(`unknown gpu action "${action}"`);
	const output = takeOption(rest, '--output').value;
	if (output) {
		const appSession = await startAppOnMonitor(output);
		print(`app alone on ${output} (workspace 10), CDP port ${appSession.appPort}`);
		return print('add --gpu --target app to perf or run; "gpu stop" gives the monitor back');
	}
	const session = await startGpuLab(await figmaFileUrl(takeOption(rest, '--url').value));
	print(
		`GPU lab: Figma on CDP port ${session.figmaPort}, app on ${session.appPort}, on Hyprland output LABGPU`
	);
	print('add --gpu to run, check, perf or state to use it');
}

async function figmaFileUrl(explicit: string | undefined): Promise<string> {
	if (explicit) return explicit;
	const userTabs = await listTargets(USER_CHROMIUM_PORT).catch(() => []);
	const userTab = userTabs.find(isFigmaFile);
	if (userTab) return userTab.url;
	const previous = readBrowserSession();
	if (previous) return previous.url;
	throw new Error(
		`pass --url <figma design file url> (no Figma tab on port ${USER_CHROMIUM_PORT} to copy it from)`
	);
}

async function copyToFigma(args: string[]): Promise<void> {
	const { rest, value: pageOption } = takeOption(args, '--page');
	const [file, name] = rest;
	if (!file || !name)
		throw new Error('usage: copy-to-figma <file.ndesign> <node name> [--page <name>]');
	const tree = readSubtree(file, name);
	const figma = targetByName('figma');
	const cdp = await CdpSession.connect(figma.port(), figma.matches);
	try {
		const pageName = pageOption || `${name} repro`;
		const summary = await cdp.evaluate(
			`(${FIGMA_BUILDER})(${JSON.stringify(tree)}, ${JSON.stringify(pageName)})`
		);
		print(JSON.stringify(summary, null, 2));
	} finally {
		cdp.close();
	}
}

interface ParsedScript {
	scriptId: string;
	url: string;
	hash: string;
	scriptLanguage?: string;
}

// Debugger.enable replays scriptParsed for every script already loaded, including wasm modules.
async function dumpSources(args: string[]): Promise<void> {
	const directory = args[0];
	if (!directory) throw new Error('missing <directory>');
	mkdirSync(directory, { recursive: true });
	const figma = targetByName('figma');
	const cdp = await CdpSession.connect(figma.port(), figma.matches);
	const scripts: ParsedScript[] = [];
	cdp.on('Debugger.scriptParsed', (params) => scripts.push(params as unknown as ParsedScript));
	try {
		await cdp.send('Debugger.enable');
		await new Promise((resolve) => setTimeout(resolve, 2000));
		const index = [];
		for (const script of scripts.filter((candidate) => candidate.url.length > 0)) {
			const file = await writeScript(cdp, script, directory);
			index.push({ url: script.url, hash: script.hash, language: script.scriptLanguage, file });
		}
		writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index, null, '\t'));
		print(`${index.length} scripts written to ${directory}`);
	} finally {
		await cdp.send('Debugger.disable');
		cdp.close();
	}
}

async function writeScript(
	cdp: CdpSession,
	script: ParsedScript,
	directory: string
): Promise<string> {
	const source = await cdp.send<{ scriptSource: string; bytecode?: string }>(
		'Debugger.getScriptSource',
		{ scriptId: script.scriptId }
	);
	// CDP returns decoded content, so a `.br` (brotli) suffix from the URL would be misleading.
	const baseName = path.basename(new URL(script.url).pathname).replace(/\.br$/, '') || 'index';
	const prefix = `${script.scriptId}-`;
	if (source.bytecode) {
		const fileName = `${prefix}${baseName.replace(/\.wasm$/, '')}.wasm`;
		writeFileSync(path.join(directory, fileName), Buffer.from(source.bytecode, 'base64'));
		return fileName;
	}
	const fileName = `${prefix}${baseName}`;
	writeFileSync(path.join(directory, fileName), source.scriptSource);
	return fileName;
}

// Removes `--flag value` from args and returns the value separately.
function takeOption(args: string[], flag: string): { rest: string[]; value?: string } {
	const index = args.indexOf(flag);
	if (index === -1) return { rest: args };
	return { rest: [...args.slice(0, index), ...args.slice(index + 2)], value: args[index + 1] };
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
