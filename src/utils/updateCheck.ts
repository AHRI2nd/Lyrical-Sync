import { getVersion } from "@tauri-apps/api/app";

export const GITHUB_REPO = "AHRI2nd/Lyrical-Sync";
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  return aMaj !== bMaj ? aMaj - bMaj : aMin !== bMin ? aMin - bMin : aPat - bPat;
}

/** Returns the newer tag_name if one exists, otherwise null. */
export async function checkForUpdate(): Promise<string | null> {
  const current = await getVersion();
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
  if (!res.ok) return null;
  const data = await res.json();
  const latest: string = data.tag_name ?? "";
  return latest && compareSemver(latest, current) > 0 ? latest : null;
}
