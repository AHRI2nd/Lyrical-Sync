// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpotifySection } from "./SpotifySection";
import { useI18nStore } from "../../stores/useI18nStore";

afterEach(cleanup);

it("requires saving a changed Client ID before Spotify Connect uses it", async () => {
  const { t } = useI18nStore.getState();
  const onSaveClientId = vi.fn();
  const user = userEvent.setup();
  const view = render(<SpotifySection clientId="saved-id" onSaveClientId={onSaveClientId} spotifyMode={false} onToggleMode={() => {}} />);
  const input = screen.getByRole("textbox", { name: t.spotifyClientId });

  await user.clear(input);
  await user.type(input, "draft-id");
  expect((screen.getByRole("button", { name: t.spotifyConnect }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(t.spotifyClientIdNeedsSave)).toBeTruthy();

  await user.click(screen.getByRole("button", { name: t.spotifyClientIdSave }));
  expect(onSaveClientId).toHaveBeenCalledWith("draft-id");
  view.rerender(<SpotifySection clientId="draft-id" onSaveClientId={onSaveClientId} spotifyMode={false} onToggleMode={() => {}} />);
  expect((screen.getByRole("button", { name: t.spotifyConnect }) as HTMLButtonElement).disabled).toBe(false);
});

it("names the Spotify client ID field and mode switch", () => {
  const { t } = useI18nStore.getState();
  render(<SpotifySection clientId="client" onSaveClientId={() => {}} spotifyMode={false} onToggleMode={() => {}} />);
  expect(screen.getByRole("textbox", { name: t.spotifyClientId })).toBeTruthy();
  expect(screen.getByRole("switch", { name: t.spotifyModeToggle })).toBeTruthy();
});
