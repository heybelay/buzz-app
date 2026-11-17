// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChannelSettingsPanel } from "./ChannelSettingsPanel";

vi.mock("../../features/developer/mode", () => ({
  developerMode: false,
  diagnosticsAvailable: false,
}));

afterEach(cleanup);

it("hides Diagnostics outside developer and test builds", () => {
  render(
    <ChannelSettingsPanel
      scope="community:viewer"
      channel={{ id: "alpha", name: "Alpha", channelType: "stream" }}
      close={() => {}}
    >
      <button type="button">Refresh messages</button>
    </ChannelSettingsPanel>,
  );
  expect(screen.getByRole("heading", { name: "Alpha" })).toBeVisible();
  expect(screen.queryByText("Diagnostics")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Refresh messages" }),
  ).not.toBeInTheDocument();
});
