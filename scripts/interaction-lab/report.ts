import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatPoint, type Experiment, type Lab, type NodeState, type Sample } from './lab';

export interface RunInfo {
	experiment: Experiment;
	target: string;
	startedAt: Date;
	file: string;
	error: string | null;
}

export function writeReport(lab: Lab, info: RunInfo): void {
	const payload = {
		experiment: info.experiment.name,
		target: info.target,
		question: info.experiment.question,
		startedAt: info.startedAt.toISOString(),
		file: info.file,
		error: info.error,
		results: lab.results,
		notes: lab.notes,
		samples: lab.samples
	};
	writeFileSync(
		path.join(lab.outputDirectory, 'samples.json'),
		JSON.stringify(payload, null, '\t')
	);
	writeFileSync(path.join(lab.outputDirectory, 'report.md'), renderMarkdown(lab, info));
}

function renderMarkdown(lab: Lab, info: RunInfo): string {
	const lines = [
		`# ${info.experiment.name} (${info.target})`,
		'',
		info.experiment.question,
		'',
		`Run ${info.startedAt.toISOString()} against ${info.target}, file "${info.file}" (page "CDP lab").`,
		`Re-run: \`bun run interactions run ${info.experiment.name} --target ${info.target}\``,
		''
	];
	if (info.error) lines.push(`**Run failed:** ${info.error}`, '');
	if (lab.results.length > 0) {
		lines.push('## Results', '', '| Measurement | Value |', '| --- | --- |');
		for (const result of lab.results) lines.push(`| ${result.key} | ${escapeCell(result.value)} |`);
		lines.push('');
	}
	if (lab.notes.length > 0) {
		lines.push('## Notes', '');
		for (const note of lab.notes) lines.push(`- ${note}`);
		lines.push('');
	}
	lines.push(
		'## Trace',
		'',
		'Selection after every input. Pointer in canvas coordinates; node x,y relative to its parent.',
		'',
		'| # | Input | Pointer | Button | Keys | Selection | Shot |',
		'| --- | --- | --- | --- | --- | --- | --- |'
	);
	lab.samples.forEach((sample, index) => lines.push(renderSampleRow(sample, index + 1)));
	lines.push('');
	return lines.join('\n');
}

function renderSampleRow(sample: Sample, number: number): string {
	let pointer = '';
	if (sample.pointerCanvas) pointer = formatPoint(sample.pointerCanvas);
	let button = '';
	if (sample.buttonDown) button = 'down';
	let shot = '';
	if (sample.shot) shot = `![](${sample.shot})`;
	const selection = sample.selection.map(describeNode).join('; ');
	const cells = [
		number,
		sample.label,
		pointer,
		button,
		sample.modifiers.join('+'),
		selection,
		shot
	];
	return `| ${cells.map((cell) => escapeCell(String(cell))).join(' | ')} |`;
}

function describeNode(node: NodeState): string {
	let parent = '?';
	if (node.parent) parent = node.parent.name;
	return `${node.name} ${formatPoint({ x: node.x, y: node.y })} in ${parent}[${node.index}]`;
}

function escapeCell(text: string): string {
	return text.replace(/\|/g, '\\|');
}
