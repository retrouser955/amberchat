export type MarkdownInline =
	| { type: "text"; value: string }
	| {
			type: "bold" | "italic" | "underline" | "strike" | "spoiler";
			children: MarkdownInline[];
	  };

export type MarkdownBlock =
	| { type: "paragraph"; children: MarkdownInline[] }
	| { type: "heading"; level: 1 | 2 | 3 | 4; children: MarkdownInline[] }
	| { type: "codeblock"; value: string; language: string };

type InlineDelimiter = "bold" | "italic" | "underline" | "strike" | "spoiler";

const DELIMITERS: { token: string; type: InlineDelimiter }[] = [
	{ token: "**", type: "bold" },
	{ token: "__", type: "underline" },
	{ token: "~~", type: "strike" },
	{ token: "||", type: "spoiler" },
	{ token: "*", type: "italic" },
	{ token: "_", type: "italic" }
];

const ESCAPABLE = "*_~|`#\\";

const FENCE = /^\s*```(.*)$/;
const FENCE_CLOSE = /^\s*```+\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;

const MAX_DEPTH = 12;

// Discord-flavoured subset: headings h1-h4, fenced code blocks, bold, italic,
// underline, strikethrough and spoilers. Anything else stays literal.
export function parseMarkdown(source: string): MarkdownBlock[] {
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	const blocks: MarkdownBlock[] = [];
	let paragraph: string[] = [];

	const flush = () => {
		if (paragraph.length === 0) return;

		blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
		paragraph = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		const fence = FENCE.exec(line);
		if (fence) {
			flush();

			const language = fence[1].trim().split(/\s+/)[0] ?? "";
			const body: string[] = [];

			for (i++; i < lines.length && !FENCE_CLOSE.test(lines[i]); i++) {
				body.push(lines[i]);
			}

			blocks.push({ type: "codeblock", value: body.join("\n"), language });
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			flush();

			blocks.push({
				type: "heading",
				level: heading[1].length as 1 | 2 | 3 | 4,
				children: parseInline(heading[2].trim())
			});
			continue;
		}

		paragraph.push(line);
	}

	flush();

	return blocks;
}

function parseInline(source: string, depth = 0): MarkdownInline[] {
	if (depth >= MAX_DEPTH) return [{ type: "text", value: source }];

	const nodes: MarkdownInline[] = [];
	let buffer = "";

	const flush = () => {
		if (!buffer) return;

		nodes.push({ type: "text", value: buffer });
		buffer = "";
	};

	let i = 0;
	while (i < source.length) {
		const char = source[i];

		if (char === "\\" && i + 1 < source.length && ESCAPABLE.includes(source[i + 1])) {
			buffer += source[i + 1];
			i += 2;
			continue;
		}

		const delimiter = DELIMITERS.find((candidate) => source.startsWith(candidate.token, i));

		if (delimiter && isOpening(source, i, delimiter.token)) {
			const start = i + delimiter.token.length;
			const end = findClosing(source, start, delimiter.token);

			if (end > start) {
				flush();
				nodes.push({
					type: delimiter.type,
					children: parseInline(source.slice(start, end), depth + 1)
				});
				i = end + delimiter.token.length;
				continue;
			}
		}

		buffer += char;
		i++;
	}

	flush();

	return nodes;
}

function findClosing(source: string, from: number, token: string): number {
	const single = token.length === 1;

	for (let i = from; i <= source.length - token.length; i++) {
		if (source[i] === "\\") {
			i++;
			continue;
		}

		if (!source.startsWith(token, i)) continue;

		// A lone `*` or `_` must not eat half of a `**` / `__` run.
		if (single && (source[i - 1] === token || source[i + 1] === token)) continue;

		// `***bold italic***` should close on the last two stars of the run.
		if (!single && source[i + token.length] === token[0]) continue;

		if (!isClosing(source, i, token)) continue;

		return i;
	}

	return -1;
}

// `|| text ||` and `2 * 3 * 4` stay literal: delimiters cannot hug whitespace.
function isOpening(source: string, index: number, token: string): boolean {
	if (isWhitespace(source[index + token.length])) return false;

	// `snake_case` and base64url tokens must not become emphasis.
	return !token.startsWith("_") || !isWordChar(source[index - 1]);
}

function isClosing(source: string, index: number, token: string): boolean {
	if (isWhitespace(source[index - 1])) return false;

	return !token.startsWith("_") || !isWordChar(source[index + token.length]);
}

function isWhitespace(char: string | undefined): boolean {
	return char === undefined || /\s/.test(char);
}

function isWordChar(char: string | undefined): boolean {
	return char !== undefined && /[A-Za-z0-9]/.test(char);
}
