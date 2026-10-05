// Markdown of the assistant's answers as HTML for the chat. The model's text is untrusted (it can
// quote anything a document contains) and the renderer can reach `window.desktop`, so raw HTML in
// it is shown as text, images as their description, and only web and mail links become links
// (opened outside the app). Everything else marked escapes itself.

import { Marked, type Tokens } from 'marked';

const SAFE_LINK = /^(?:https?:|mailto:)/i;

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const markdown = new Marked({
	gfm: true,
	breaks: true,
	async: false,
	renderer: {
		html(token: Tokens.HTML | Tokens.Tag): string {
			return escapeHtml(token.text);
		},
		image(token: Tokens.Image): string {
			return escapeHtml(token.text);
		},
		link(token: Tokens.Link): string {
			const label = this.parser.parseInline(token.tokens);
			if (!SAFE_LINK.test(token.href)) return label;
			let title = '';
			if (token.title) title = ` title="${escapeHtml(token.title)}"`;
			return `<a href="${escapeHtml(token.href)}"${title} target="_blank" rel="noopener noreferrer">${label}</a>`;
		}
	}
});

/** Safe HTML for `text`. */
export function renderMarkdown(text: string): string {
	return markdown.parse(text, { async: false });
}
