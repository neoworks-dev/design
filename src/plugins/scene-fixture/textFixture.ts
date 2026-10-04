// Text examples of the scene fixture: styles, runs, alignment, lists, truncation, resize modes
// and a font that is not installed (drawn with the bundled substitute, reference kept).

import type { Matrix2x3, Paint, Paragraph, TextNode, TextRun, TextStyle } from '../../lib/document';
import { emptyParagraph } from '../../lib/document/text';
import { frame, node, type NodeSpec } from '../../lib/document/fixtures';

function translation(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

function ink(red: number, green: number, blue: number): Paint[] {
	return [
		{
			type: 'SOLID',
			visible: true,
			opacity: 1,
			blendMode: 'NORMAL',
			color: { r: red, g: green, b: blue }
		}
	];
}

const GEIST = { family: 'Geist', style: 'Regular' };
const GEIST_BOLD = { family: 'Geist', style: 'Bold' };
const GEIST_MEDIUM = { family: 'Geist', style: 'Medium' };

export const TEXT_FRAME_ID = 'frame-text';

function run(text: string, style: Partial<TextStyle> = {}): TextRun {
	return { text, style };
}

function paragraph(runs: TextRun[], props: Partial<Paragraph> = {}): Paragraph {
	return { ...emptyParagraph(), runs, ...props };
}

function plain(text: string, props: Partial<Paragraph> = {}): Paragraph {
	return paragraph([run(text)], props);
}

interface TextSpec {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	paragraphs: Paragraph[];
	props?: Partial<TextNode>;
	style?: Partial<TextStyle>;
}

function text(spec: TextSpec): NodeSpec {
	const defaultStyle: Partial<TextStyle> = {
		fontName: GEIST,
		fontSize: 16,
		fills: ink(0.1, 0.1, 0.14),
		...spec.style
	};
	return node('TEXT', {
		id: spec.id,
		name: spec.id,
		width: spec.width,
		height: spec.height,
		transform: translation(spec.x, spec.y),
		paragraphs: spec.paragraphs,
		defaultStyle: defaultStyleWith(defaultStyle),
		textAutoResize: 'WIDTH_AND_HEIGHT',
		...spec.props
	});
}

function defaultStyleWith(overrides: Partial<TextStyle>): TextStyle {
	return {
		fontName: GEIST,
		fontWeight: 400,
		fontSize: 16,
		letterSpacing: { value: 0, unit: 'PERCENT' },
		lineHeight: { unit: 'AUTO' },
		textCase: 'ORIGINAL',
		textDecoration: 'NONE',
		openTypeFeatures: {},
		fontVariations: {},
		fills: ink(0, 0, 0),
		...overrides
	};
}

const LOREM =
	'Design tools lay text out with real shaping: kerning, ligatures and wrapping all come from the Paragraph API.';

export function textFrame(): NodeSpec {
	return frame(
		{
			id: TEXT_FRAME_ID,
			name: 'Text',
			width: 700,
			height: 900,
			transform: translation(1400, 0),
			fills: [
				{
					type: 'SOLID',
					visible: true,
					opacity: 1,
					blendMode: 'NORMAL',
					color: { r: 1, g: 1, b: 1 }
				}
			]
		},
		[
			text({
				id: 'text-heading',
				x: 30,
				y: 24,
				width: 204,
				height: 40,
				paragraphs: [paragraph([run('Heading text')])],
				style: { fontName: GEIST_BOLD, fontWeight: 700, fontSize: 32 }
			}),
			text({
				id: 'text-body',
				x: 30,
				y: 84,
				width: 300,
				height: 60,
				paragraphs: [plain(LOREM)],
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-runs',
				x: 360,
				y: 84,
				width: 300,
				height: 40,
				paragraphs: [
					paragraph([
						run('Runs: '),
						run('bold', { fontName: GEIST_BOLD, fontWeight: 700 }),
						run(', '),
						run('red', { fills: ink(0.85, 0.15, 0.15) }),
						run(', '),
						run('underlined', { textDecoration: 'UNDERLINE' }),
						run(', '),
						run('struck', { textDecoration: 'STRIKETHROUGH' }),
						run(' and a '),
						run('link', {
							hyperlink: { type: 'URL', value: 'https://example.com' },
							fills: ink(0.1, 0.4, 0.95)
						}),
						run(' in one paragraph.')
					])
				],
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-left',
				x: 30,
				y: 220,
				width: 150,
				height: 60,
				paragraphs: [plain('Left aligned text wraps inside a fixed width box.')],
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-center',
				x: 200,
				y: 220,
				width: 150,
				height: 60,
				paragraphs: [plain('Centered text wraps inside a fixed width box.', { align: 'CENTER' })],
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-right',
				x: 370,
				y: 220,
				width: 150,
				height: 40,
				paragraphs: [plain('Right aligned text wraps inside a box.', { align: 'RIGHT' })],
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-justified',
				x: 540,
				y: 220,
				width: 130,
				height: 60,
				paragraphs: [plain('Justified text spreads words to both edges.', { align: 'JUSTIFIED' })],
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-bullets',
				x: 30,
				y: 360,
				width: 300,
				height: 104,
				paragraphs: [
					plain('Bulleted list', { spacingAfter: 4 }),
					plain('First item', { list: 'UNORDERED' }),
					plain('Second item wraps onto a second line when it is long enough', {
						list: 'UNORDERED'
					}),
					plain('Nested item', { list: 'UNORDERED', listLevel: 1 })
				],
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-numbers',
				x: 360,
				y: 360,
				width: 300,
				height: 84,
				paragraphs: [
					plain('Numbered list', { spacingAfter: 4 }),
					plain('Sketch', { list: 'ORDERED' }),
					plain('Refine', { list: 'ORDERED' }),
					plain('Ship', { list: 'ORDERED' })
				],
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-spacing',
				x: 30,
				y: 530,
				width: 300,
				height: 96,
				paragraphs: [
					plain('LETTER SPACING AND LINE HEIGHT'),
					plain('Paragraph spacing separates blocks of text from each other.')
				],
				style: {
					letterSpacing: { value: 8, unit: 'PERCENT' },
					lineHeight: { value: 150, unit: 'PERCENT' }
				},
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-case',
				x: 360,
				y: 530,
				width: 300,
				height: 60,
				paragraphs: [
					paragraph([run('title case text', { textCase: 'TITLE' })]),
					paragraph([run('upper case text', { textCase: 'UPPER' })]),
					paragraph([run('LOWER CASE TEXT', { textCase: 'LOWER' })])
				],
				style: { fontName: GEIST_MEDIUM, fontWeight: 500 },
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-missing-font',
				x: 30,
				y: 670,
				width: 300,
				height: 22,
				paragraphs: [plain('Papyrus is not installed here')],
				style: { fontName: { family: 'Papyrus', style: 'Regular' }, fontSize: 18 },
				props: { textAutoResize: 'HEIGHT' }
			}),
			text({
				id: 'text-truncated',
				x: 360,
				y: 670,
				width: 300,
				height: 44,
				paragraphs: [plain(`${LOREM} ${LOREM}`)],
				props: { textAutoResize: 'NONE', textTruncation: 'ENDING', maxLines: 2 }
			}),
			text({
				id: 'text-fixed-center',
				x: 30,
				y: 760,
				width: 300,
				height: 100,
				paragraphs: [plain('Fixed box, centered vertically', { align: 'CENTER' })],
				props: { textAutoResize: 'NONE', textAlignVertical: 'CENTER' }
			}),
			text({
				id: 'text-symbols',
				x: 360,
				y: 760,
				width: 300,
				height: 20,
				paragraphs: [plain('Symbols and quotes: → ½ — “quoted” ©')],
				props: { textAutoResize: 'HEIGHT' }
			})
		]
	);
}
