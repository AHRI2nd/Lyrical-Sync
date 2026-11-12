export function hasProxyCredentials(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;

  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) return true;
  } catch {
    // Keep accepting existing proxy input syntax, but still reject userinfo in
    // malformed authority strings before they can reach persistence or argv.
  }

  const schemeSeparator = candidate.indexOf("://");
  const authorityStart = schemeSeparator >= 0 ? schemeSeparator + 3 : 0;
  const authority = candidate.slice(authorityStart).split(/[/?#]/, 1)[0];
  return authority.includes("@");
}

export function withoutProxyCredentials(value: string): string {
  return hasProxyCredentials(value) ? "" : value;
}
