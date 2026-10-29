// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SpotifySection } from "./SpotifySection";
import { useI18nStore } from "../../stores/useI18nStore";

afterEach(cleanup);

it("names the Spotify client ID field and mode switch", () => {
  const { t } = useI18nStore.getState();
  render(<SpotifySection clientId="client" onSaveClientId={() => {}} spotifyMode={false} onToggleMode={() => {}} />);
  expect(screen.getByRole("textbox", { name: t.spotifyClientId })).toBeTruthy();
  expect(screen.getByRole("switch", { name: t.spotifyModeToggle })).toBeTruthy();
});
