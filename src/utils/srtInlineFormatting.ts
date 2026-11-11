export interface SrtInlineFormattingToken {
  start: number;
  end: number;
  tag: "b" | "i" | "u";
  closing: boolean;
}

type RenderTarget = "ass" | "vtt";

function validatedTokens(
  text: string,
  tokens: readonly SrtInlineFormattingToken[],
): readonly SrtInlineFormattingToken[] | null {
  if (tokens.length === 0) return null;
  const stack: SrtInlineFormattingToken["tag"][] = [];
  let cursor = 0;

  for (const token of tokens) {
    if (!Number.isInteger(token.start) || !Number.isInteger(token.end) ||
        token.start < cursor || token.end <= token.start || token.end > text.length ||
        !["b", "i", "u"].includes(token.tag)) return null;
    const rawTag = text.slice(token.start, token.end);
    const expected = token.closing ? `</${token.tag}>` : `<${token.tag}>`;
    if (rawTag.toLowerCase() !== expected) return null;
    if (token.closing) {
      if (stack.pop() !== token.tag) return null;
    } else {
      stack.push(token.tag);
    }
    cursor = token.end;
  }

  return stack.length === 0 ? tokens : null;
}

/** Remove only parser-recorded, balanced supported tags; malformed or stale text remains literal. */
export function stripSrtInlineFormatting(
  text: string,
  tokens: readonly SrtInlineFormattingToken[] | undefined,
): string | null {
  if (!tokens || !validatedTokens(text, tokens)) return null;
  let output = "";
  let cursor = 0;
  for (const token of tokens) {
    output += text.slice(cursor, token.start);
    cursor = token.end;
  }
  return output + text.slice(cursor);
}

/** Keep known raw style tokens as SRT markup and entity-encode identical literal text. */
export function serializeSrtInlineFormatting(
  text: string,
  tokens: readonly SrtInlineFormattingToken[] | undefined,
): string {
  const valid = tokens ? validatedTokens(text, tokens) : null;
  const encodeLiteralTags = (value: string) => value.replace(/<\/?(b|i|u)>/gi, (tag) =>
    tag.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  if (!valid) return encodeLiteralTags(text);

  let output = "";
  let cursor = 0;
  for (const token of valid) {
    output += encodeLiteralTags(text.slice(cursor, token.start));
    output += text.slice(token.start, token.end);
    cursor = token.end;
  }
  return output + encodeLiteralTags(text.slice(cursor));
}

/** Convert only parser-recorded balanced style tokens; malformed metadata falls back to escaped text. */
export function renderSrtInlineFormatting(
  text: string,
  tokens: readonly SrtInlineFormattingToken[] | undefined,
  target: RenderTarget,
  escapeText: (value: string) => string,
): string | null {
  if (!tokens || !validatedTokens(text, tokens)) return null;
  const stack: SrtInlineFormattingToken["tag"][] = [];
  const active = new Map<SrtInlineFormattingToken["tag"], number>();
  let output = "";
  let cursor = 0;

  for (const token of tokens) {
    output += escapeText(text.slice(cursor, token.start));
    if (token.closing) {
      stack.pop();
      const count = active.get(token.tag) ?? 0;
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
