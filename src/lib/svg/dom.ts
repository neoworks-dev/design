// SVG is case sensitive (`linearGradient`), but not every DOM implementation keeps the case when
// it parses markup, so element names are compared in lower case throughout the importer.

export function tagName(element: Element): string {
	return element.localName.toLowerCase();
}
