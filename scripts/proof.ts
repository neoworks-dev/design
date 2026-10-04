// Posts proof of work on an issue: screenshots go to the `qa-screenshots` branch, the text and
// the embedded images become an issue comment. All GitHub writes go through `gh bot`.
//
// Usage: bun run proof <issue> --body <file|text> [--shot <png> ...]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repository = 'neoworks-dev/design';
const proofBranch = 'qa-screenshots';
const projectRoot = path.resolve(import.meta.dirname, '..');

interface Arguments {
	issue: number;
	body: string;
	shots: string[];
}

function main(): void {
	const options = parseArguments(process.argv.slice(2));
	const images = options.shots.map((shot) => uploadScreenshot(options.issue, shot));
	const sections = [options.body.trim()];
	if (images.length > 0) sections.push(images.join('\n\n'));
	postComment(options.issue, sections.join('\n\n'));
	process.stdout.write(`posted proof on #${options.issue} (${images.length} screenshot(s))\n`);
}

function parseArguments(args: string[]): Arguments {
	const issue = Number(args[0]);
	if (!Number.isInteger(issue) || issue <= 0)
		throw new Error('usage: bun run proof <issue> --body <file|text> [--shot <png> ...]');
	let body = '';
	const shots: string[] = [];
	for (let index = 1; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (value === undefined) throw new Error(`missing value for ${flag}`);
		if (flag === '--body') body = readBody(value);
		else if (flag === '--shot') shots.push(value);
		else throw new Error(`unknown flag ${flag}`);
	}
	if (!body) throw new Error('--body is required: what was done and why');
	return { issue, body, shots };
}

function readBody(value: string): string {
	if (existsSync(value)) return readFileSync(value, 'utf8');
	return value;
}

// Commits the PNG to the proof branch through the contents API; returns markdown embedding it.
function uploadScreenshot(issue: number, shotPath: string): string {
	if (!existsSync(shotPath)) throw new Error(`screenshot not found: ${shotPath}`);
	const fileName = `${Date.now()}-${path.basename(shotPath)}`;
	const remotePath = `issues/${issue}/${fileName}`;
	const payload = {
		message: `Proof screenshot for #${issue}`,
		content: readFileSync(shotPath).toString('base64'),
		branch: proofBranch
	};
	ghBot([
		'api',
		'-X',
		'PUT',
		`repos/${repository}/contents/${remotePath}`,
		'--input',
		writeTemporary('payload.json', JSON.stringify(payload))
	]);
	const url = `https://raw.githubusercontent.com/${repository}/${proofBranch}/${remotePath}`;
	return `![${path.basename(shotPath)}](${url})`;
}

function postComment(issue: number, body: string): void {
	const bodyFile = writeTemporary('comment.md', body);
	ghBot(['issue', 'comment', String(issue), '-R', repository, '--body-file', bodyFile]);
}

// gh bot resolves its app token from the repository, so it must run inside the checkout.
function ghBot(args: string[]): void {
	const result = spawnSync('gh', ['bot', ...args], { cwd: projectRoot, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`gh bot ${args[0]} failed: ${result.stderr || result.stdout}`);
	}
}

function writeTemporary(name: string, content: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'proof-'));
	const filePath = path.join(directory, name);
	writeFileSync(filePath, content);
	return filePath;
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
}
