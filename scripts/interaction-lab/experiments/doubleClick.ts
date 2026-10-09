import type { Experiment, Lab } from '../lab';

function names(selection: Array<{ name: string }>): string {
	if (selection.length === 0) return 'nothing';
	return selection.map((node) => node.name).join('+');
}

interface SecondClick {
	delay: number;
	offset: number;
	escapeBetween: boolean;
}

/** Click A, then click it again after `delay` ms; returns what is selected after each click. */
async function clickTwice(lab: Lab, name: string, second: SecondClick): Promise<string> {
	await lab.tap('Escape');
	await lab.tap('Escape');
	await lab.pause(800);
	const point = await lab.nodePoint(name);
	const first = await lab.click(point);
	if (second.escapeBetween) await lab.tap('Escape');
	await lab.pause(second.delay);
	const secondSample = await lab.click({ x: point.x + second.offset, y: point.y });
	return `${names(first.selection)} → ${names(secondSample.selection)}`;
}

export const doubleClick: Experiment = {
	name: 'double-click',
	question:
		'When do two clicks count as a double-click (time and distance), what does a double-click on a rectangle and on a frame child do, and does Escape between the clicks reset it? (moving.md experiment 4)',
	async run(lab) {
		for (const delay of [100, 300, 450, 600, 800]) {
			lab.result(
				`A clicked twice, ${delay} ms apart`,
				await clickTwice(lab, 'A', { delay, offset: 0, escapeBetween: false })
			);
		}
		for (const offset of [3, 6, 10]) {
			lab.result(
				`A clicked twice 100 ms apart, second ${offset}px right`,
				await clickTwice(lab, 'A', { delay: 100, offset, escapeBetween: false })
			);
		}
		lab.result(
			'A clicked, Escape, clicked again 100 ms later',
			await clickTwice(lab, 'A', { delay: 100, offset: 0, escapeBetween: true })
		);
		lab.result(
			'C (inside Frame) clicked twice, 100 ms apart',
			await clickTwice(lab, 'C', { delay: 100, offset: 0, escapeBetween: false })
		);
		await lab.shot('after-double-click-c');
		lab.result(
			'S1 (inside Stack) clicked twice, 100 ms apart',
			await clickTwice(lab, 'S1', { delay: 100, offset: 0, escapeBetween: false })
		);
	}
};
