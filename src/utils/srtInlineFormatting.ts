export interface SrtInlineFormattingToken {
  start: number;
  end: number;
  tag: "b" | "i" | "u";
  closing: boolean;
}

type RenderTarget = "ass" | "vtt";

/**
 * Converts only parser-recorded, balanced SRT formatting tokens. Any stale or
 * malformed token metadata falls back to escaped literal text at the caller.
 */
export function renderSrtInlineFormatting(
  text: string,
  tokens: readonly SrtInlineFormattingToken[],
  target: RenderTarget,
  escapeText: (value: string) => string,
): string | null {
  if (tokens.length === 0) return null;

  const stack: SrtInlineFormattingToken["tag"][] = [];
  const active = new Map<SrtInlineFormattingToken["tag"], number>();
  let output = "";
  let cursor = 0;

  for (const token of tokens) {
    if (!Number.isInteger(token.start) || !Number.isInteger(token.end) ||
        token.start < cursor || token.end <= token.start || token.end > text.length) return null;
    const rawTag = text.slice(token.start, token.end);
    const expected = token.closing ? `</${token.tag}>` : `<${token.tag}>`;
    if (rawTag.toLowerCase() !== expected) return null;

    output += escapeText(text.slice(cursor, token.start));
    if (token.closing) {
      if (stack.pop() !== token.tag) return null;
      const count = active.get(token.tag) ?? 0;
      if (count <= 0) return null;
      if (target === "ass" && count === 1) output += `{\\${token.tag}0}`;
      if (count === 1) active.delete(token.tag);
      else active.set(token.tag, count - 1);
    } else {
      stack.push(token.tag);
      const count = active.get(token.tag) ?? 0;
      if (target === "ass" && count === 0) output += `{\\${token.tag}1}`;
      active.set(token.tag, count + 1);
    }
    if (target === "vtt") output += token.closing ? `</${token.tag}>` : `<${token.tag}>`;
    cursor = token.end;
  }

  if (stack.length > 0) return null;
  return output + escapeText(text.slice(cursor));
}
