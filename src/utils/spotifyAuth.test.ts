import { describe, it, expect } from "vitest";
import { generatePkce, buildAuthUrl, SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES } from "./spotifyAuth";

// PKCE S256 트랜스폼(challenge = base64url(sha256(verifier)))을 독립적으로 재계산해
// generatePkce()의 결과와 대조 — 랜덤값 자체를 고정하지 않고도 구현 정확성을 검증.
async function expectedChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

describe("generatePkce", () => {
  it("produces a 64-character code verifier using only unreserved URL characters", async () => {
    const { codeVerifier } = await generatePkce();
    expect(codeVerifier).toHaveLength(64);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("derives the code challenge as base64url(sha256(verifier))", async () => {
    const { codeVerifier, codeChallenge } = await generatePkce();
    expect(codeChallenge).toBe(await expectedChallenge(codeVerifier));
  });

  it("produces a base64url string with no +, /, or = padding", async () => {
    const { codeChallenge } = await generatePkce();
    expect(codeChallenge).not.toMatch(/[+/=]/);
  });

  it("generates a different verifier on each call", async () => {
    const a = await generatePkce();
    const b = await generatePkce();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe("buildAuthUrl", () => {
  it("targets Spotify's authorize endpoint with all required PKCE params", () => {
    const url = new URL(buildAuthUrl("my-client-id", "the-challenge", "the-state"));
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("my-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(SPOTIFY_REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("the-challenge");
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("scope")).toBe(SPOTIFY_SCOPES);
  });

  it("URL-encodes values that need it (spaces, symbols)", () => {
    const url = new URL(buildAuthUrl("client id/with symbols", "c", "s&t=1"));
    expect(url.searchParams.get("client_id")).toBe("client id/with symbols");
    expect(url.searchParams.get("state")).toBe("s&t=1");
  });
});
