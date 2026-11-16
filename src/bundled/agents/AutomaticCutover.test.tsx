// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type CutoverCopy,
  type CutoverMode,
  cutoverOffer,
  setCutoverOffer,
  takeCutover,
} from "../../features/agents/cutover";
import { setRuntimeRecommendation } from "../../features/agents/recommended";
import type {
  Agent,
  Agents,
  AgentsSnapshot,
  RegisteredAgentType,
} from "../../features/agents/service";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import {
  AutomaticCutover,
  CUTOVER_WINDOW_MS,
  resetCutoverLaunch,
  SAVE_MS,
} from "./AutomaticCutover";

let focused = true;
/** The window gaining or losing focus. */
const focus = (next: boolean) => {
  focused = next;
  window.dispatchEvent(new Event(next ? "focus" : "blur"));
};

// Sonner's swipe handling needs it; jsdom lacks it.
HTMLElement.prototype.setPointerCapture ??= () => {};

// Synthetic agents, models and copy; real copy comes only from a packager's plugin.
const OFFER = {
  mode: "optInPrompt" as CutoverMode,
  copy: {
    title: "Keep your agent up to date",
    body: "Buzz will manage {agent}'s AI. It'll use {model} today.\nYou can opt out.",
    acceptLabel: "Sounds good",
    optOutLabel: "Opt out",
  },
  excludeWords: ["GPT", "Codex"],
};
/** Any ISO 8601 time: when it was answered. */
const AT = expect.stringMatching(/^\d{4}-\d\d-\d\dT/);
const CANDIDATE = {
  harness: "codex",
  model: "model-a",
  effort: "high",
  label: "Model A",
};
const agent = (change: Partial<Agent> = {}) =>
  ({
    key: "a".repeat(64),
    pubkey: "a".repeat(64),
    name: "Agent A",
    type: "buzz.codex/codex",
    owner: "b".repeat(64),
    relay: "wss://relay.example",
    place: "here",
    attention: {},
    skipped: {},
    timers: {},
    attentionEnabled: false,
    config: { model: "model-x", effort: "low", instructions: "Be brief." },
    configBase: { settings: "head-1" },
    ...change,
  }) as Agent;

function fixture({
  agents = [agent()],
  ready = true,
  save = vi.fn(async () => {}),
  started = true,
}: {
  agents?: readonly Agent[];
  /** Whether plugin start-up is already over. */
  started?: boolean;
  /** Whether the harness can run the candidate now, or a check to hold. */
  ready?: boolean | (() => Promise<boolean>);
  save?: ReturnType<typeof vi.fn>;
} = {}) {
  let snapshot = {
    status: "ready",
    agents,
    running: agents,
    interrupted: [],
    teams: [],
  } as unknown as AgentsSnapshot;
  const listeners = new Set<() => void>();
  /** Another device's change arriving. */
  const update = (next: readonly Agent[]) => {
    snapshot = { ...snapshot, agents: next, running: next };
    for (const listener of listeners) listener();
  };
  let types = [
    {
      key: "buzz.codex/codex",
      id: "codex",
      title: "Codex",
      icon: () => <svg data-testid="harness-mark" />,
      recommends: vi.fn(async () =>
        typeof ready === "function" ? ready() : ready,
      ),
    },
    // A hosted type: its agents can't be switched, so they aren't counted.
    {
      key: "hosted/example",
      id: "hosted-example",
      title: "Hosted",
      remote: {},
    },
  ] as unknown as readonly RegisteredAgentType[];
  const service = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => snapshot,
    types: () => types,
    pluginsStarted: () => started,
    save,
  } as unknown as Agents;
  const view = render(<AutomaticCutover agents={service} />, {
    wrapper: ToastProvider,
  });
  /** Plugin start-up ends, with `late` types registered as it does. */
  const settle = (late: readonly object[] = []) => {
    types = [...types, ...late] as unknown as typeof types;
    started = true;
    for (const listener of listeners) listener();
  };
  return { save, view, service, update, settle };
}
/** A save that, like the real one, leaves the agent with the saved config. */
const keeping = () => {
  let update = (_next: readonly Agent[]) => {};
  const save = vi.fn(async (_key: string, { config }: { config: object }) => {
    update([agent({ config: config as Agent["config"] })]);
  });
  return {
    save,
    attach: (made: { update: typeof update }) => {
      update = made.update;
    },
  };
};

beforeEach(() => {
  resetCutoverLaunch();
  // The Buzz window is focused and showing, unless a test says otherwise.
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  setRuntimeRecommendation({
    recommendedBy: "Example Org",
    candidates: [CANDIDATE],
  });
  setCutoverOffer(OFFER);
});
afterEach(() => {
  cleanup();
  vi.mocked(document.hasFocus).mockRestore();
  setCutoverOffer(undefined);
  setRuntimeRecommendation(undefined);
});

/** Lets the offer's effects run when nothing should show. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const withMode = (mode: CutoverMode, copy: Partial<CutoverCopy> = {}) =>
  setCutoverOffer({ ...OFFER, mode, copy: { ...OFFER.copy, ...copy } });

it("shows the offer for a qualifying agent, naming today's model", async () => {
  fixture();
  const notice = await screen.findByRole("dialog");
  expect(notice).toHaveTextContent("Keep your agent up to date");
  expect(notice).toHaveTextContent(
    "Buzz will manage Agent A's AI. It'll use Model A today.",
  );
});

it("never shows a kind it doesn't know: the offer is dropped and the setup kept", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(() => setCutoverOffer({ ...OFFER, mode: "popup" })).toThrow("mode");
    // A plugin's answer naming it, the way it really arrives.
    setCutoverOffer(OFFER);
    const setup = { recommendedBy: "Example Org", candidates: [CANDIDATE] };
    expect(
      takeCutover({ ...setup, cutover: { ...OFFER, mode: "popup" } }),
    ).toEqual(setup);
    expect(cutoverOffer()).toBeUndefined();
    const { save } = fixture();
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

it("optInPrompt changes nothing until the person says yes, then switches through the usual save", async () => {
  const { save } = fixture();
  await screen.findByRole("dialog");
  await settle();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sounds good" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith("a".repeat(64), {
    config: {
      instructions: "Be brief.",
      preset: "recommended",
      cutover: {
        answer: "accepted",
        at: AT,
        mode: "optInPrompt",
        previous: { model: "model-x", effort: "low" },
      },
    },
    base: { settings: "head-1" },
  });
});

it("optInPrompt: Opt out, or dismissing it, is a no that keeps the agent's settings", async () => {
  for (const button of ["Opt out", "Dismiss"]) {
    resetCutoverLaunch();
    const { save, view } = fixture();
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith("a".repeat(64), {
      config: {
        model: "model-x",
        effort: "low",
        instructions: "Be brief.",
        cutover: { answer: "declined", at: AT, mode: "optInPrompt" },
      },
      base: { settings: "head-1" },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.unmount();
  }
});

it("asks once: the answer saved on the agent stops it on a later launch, and right after answering nothing asks again", async () => {
  const saving = keeping();
  const made = fixture({ save: saving.save });
  saving.attach(made);
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Sounds good" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // The same launch, before the saved answer comes back from another device
  // or a reload: a remount (such as signing in again) never asks.
  act(() => made.update([agent()]));
  made.view.unmount();
  render(<AutomaticCutover agents={made.service} />, {
    wrapper: ToastProvider,
  });
  await settle();
  expect(screen.queryByRole("dialog")).toBeNull();
  // A later launch: the agent carries the answer, on any device.
  cleanup();
  resetCutoverLaunch();
  const later = fixture({
    agents: [
      agent({
        config: {
          instructions: "Be brief.",
          preset: "recommended",
          cutover: { answer: "accepted" },
        },
      }),
    ],
  });
  await settle();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(later.save).not.toHaveBeenCalled();
  expect(saving.save).toHaveBeenCalledTimes(1);
});

it("keeps the offer when Yes fails; an opt-out that can't save still closes", async () => {
  const save = vi.fn(async () => {
    throw new Error("Connect to the community to save");
  });
  fixture({ save });
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Sounds good" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn’t switch Agent A: Connect to the community to save",
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Opt out" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // Nothing was saved: the agent carries no answer.
  expect(save).toHaveBeenCalledTimes(2);
});

it("after a stuck Yes, closing records nothing, and nothing else is saved until that save settles", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    let finish = () => {};
    const saving = keeping();
    const save = vi.fn(
      (key: string, change: { config: object }) =>
        new Promise<void>((resolve) => {
          finish = () => void saving.save(key, change).then(resolve);
        }),
    );
    const made = fixture({ save });
    saving.attach(made);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Sounds good" }));
    await vi.advanceTimersByTimeAsync(SAVE_MS);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t switch Agent A: saving took too long",
    );
    // Opt out and Yes wait for the first save; closing may leave.
    expect(screen.getByRole("button", { name: "Opt out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sounds good" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The late save lands, as chosen, and nothing else was saved.
    await act(async () => finish());
    expect(save).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("closes when another device answers or switches the agent, and decides once per launch", async () => {
  const { view, service, update } = fixture();
  await screen.findByRole("dialog");
  act(() =>
    update([
      agent({
        config: { model: "model-x", cutover: { answer: "declined" } },
      }),
    ]),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // A remount in the same launch, such as signing in again, never asks.
  act(() => update([agent()]));
  view.unmount();
  render(<AutomaticCutover agents={service} />, { wrapper: ToastProvider });
  await settle();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("one agent on this computer beside a hosted one is offered, and the switch saves the local one", async () => {
  const hosted = agent({
    key: "c".repeat(64),
    pubkey: "c".repeat(64),
    name: "Agent C",
    place: "hosted",
    type: "hosted/example",
  });
  const { save } = fixture({ agents: [agent(), hosted] });
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Sounds good" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]?.[0]).toBe("a".repeat(64));
});

it("toastAutoApplied: a hosted agent beside the local one doesn't stop the switch", async () => {
  withMode("toastAutoApplied");
  const hosted = agent({
    key: "c".repeat(64),
    pubkey: "c".repeat(64),
    name: "Agent C",
    place: "hosted",
    type: "hosted/example",
  });
  const { save } = fixture({ agents: [agent(), hosted] });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]?.[0]).toBe("a".repeat(64));
});

it("decides only after plugin start-up is over", async () => {
  const made = fixture({ started: false });
  await settle();
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => made.settle());
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

it("two real agents don't qualify, even when one's type registers late; a harness plugin that never starts leaves its agent uncounted", async () => {
  setRuntimeRecommendation({
    recommendedBy: "Example Org",
    candidates: [CANDIDATE, { ...CANDIDATE, harness: "claude-code" }],
  });
  const other = agent({
    key: "c".repeat(64),
    pubkey: "c".repeat(64),
    name: "Agent C",
    type: "buzz.claude-code/claude-code",
  });
  const late = { key: "buzz.claude-code/claude-code", id: "claude-code" };
  // Its plugin registers as start-up ends: two agents, no offer.
  const made = fixture({ agents: [agent(), other], started: false });
  await settle();
  act(() => made.settle([late]));
  await settle();
  expect(screen.queryByRole("dialog")).toBeNull();
  made.view.unmount();
  // Its plugin failed to start: that agent isn't set up here, so only the
  // other counts.
  resetCutoverLaunch();
  const failed = fixture({ agents: [agent(), other], started: false });
  act(() => failed.settle());
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

it("toastAutoApplied switches only while the window is focused, and the notice comes with the switch", async () => {
  withMode("toastAutoApplied");
  focused = false;
  const saving = keeping();
  const made = fixture({ save: saving.save });
  saving.attach(made);
  await settle();
  expect(made.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => focus(true));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(made.save).toHaveBeenCalledTimes(1);
});

it("toastAutoApplied: focus long after the start-up window still switches, with the notice", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    withMode("toastAutoApplied");
    focused = false;
    const saving = keeping();
    const made = fixture({ save: saving.save });
    saving.attach(made);
    // Matched at start-up (its harness was checked), then a long wait.
    const [codex] = made.service.types() as unknown as [
      { recommends: ReturnType<typeof vi.fn> },
    ];
    await waitFor(() => expect(codex.recommends).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(10 * CUTOVER_WINDOW_MS);
    expect(made.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => focus(true));
    await vi.advanceTimersByTimeAsync(50);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(made.save).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("toastAutoApplied re-checks the rules at that late focus, before switching", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    withMode("toastAutoApplied");
    focused = false;
    const made = fixture();
    // Matched at start-up (its harness was checked), then a long wait.
    const [codex] = made.service.types() as unknown as [
      { recommends: ReturnType<typeof vi.fn> },
    ];
    await waitFor(() => expect(codex.recommends).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(10 * CUTOVER_WINDOW_MS);
    // Answered on another device while the window was in the background.
    act(() =>
      made.update([
        agent({
          config: { model: "model-x", cutover: { answer: "declined" } },
        }),
      ]),
    );
    act(() => focus(true));
    await vi.advanceTimersByTimeAsync(50);
    expect(made.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("toastAutoApplied still switches after an unrelated settings change before focus, revising the latest copy", async () => {
  withMode("toastAutoApplied");
  focused = false;
  const saving = keeping();
  const made = fixture({ save: saving.save });
  saving.attach(made);
  await settle();
  // Another device changed where it replies: a new revision, same model.
  act(() =>
    made.update([
      agent({
        config: {
          model: "model-x",
          effort: "low",
          instructions: "Be brief.",
          scope: "channel",
        },
        configBase: { settings: "head-2" },
      }),
    ]),
  );
  act(() => focus(true));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(made.save).toHaveBeenCalledTimes(1);
  expect(made.save.mock.calls[0]?.[1]).toMatchObject({
    base: { settings: "head-2" },
  });
});

it("toastAutoApplied doesn't switch an agent whose model changed before focus", async () => {
  withMode("toastAutoApplied");
  focused = false;
  const made = fixture();
  await settle();
  // A model picked on another device: a new settings revision.
  act(() =>
    made.update([
      agent({
        config: { model: "model-y", effort: "low" },
        configBase: { settings: "head-2" },
      }),
    ]),
  );
  act(() => focus(true));
  await settle();
  expect(made.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("toastAutoApplied re-checks the rules when focus arrives: a second agent stops it", async () => {
  withMode("toastAutoApplied");
  focused = false;
  const made = fixture();
  await settle();
  act(() =>
    made.update([agent(), agent({ pubkey: "c".repeat(64), name: "Agent C" })]),
  );
  act(() => focus(true));
  await settle();
  expect(made.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("optInPrompt shows whether or not the window is focused, and changes nothing", async () => {
  focused = false;
  const { save } = fixture();
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it("offers nothing without a plugin's offer, to excluded names, two agents, an unready harness or an answered agent", async () => {
  const cases: (() => ReturnType<typeof fixture>)[] = [
    () => {
      setCutoverOffer(undefined);
      return fixture();
    },
    () => fixture({ agents: [agent({ name: "GPT helper" })] }),
    () => fixture({ agents: [agent({ name: "Agent 6.1" })] }),
    () =>
      fixture({
        agents: [agent(), agent({ pubkey: "c".repeat(64), name: "Agent C" })],
      }),
    () => fixture({ ready: false }),
    () =>
      fixture({
        agents: [
          agent({
            config: { model: "model-x", cutover: { answer: "declined" } },
          }),
        ],
      }),
  ];
  for (const make of cases) {
    resetCutoverLaunch();
    const { save, view } = make();
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(save).not.toHaveBeenCalled();
    view.unmount();
    setCutoverOffer(OFFER);
  }
});

it("toastAutoApplied switches first, then says so; Opt out puts the agent back", async () => {
  withMode("toastAutoApplied", { acceptLabel: "Got it", optOutLabel: "Undo" });
  const saving = keeping();
  const made = fixture({ save: saving.save });
  saving.attach(made);
  const { save } = made;
  const notice = await screen.findByRole("dialog");
  expect(notice).toHaveTextContent("Keep your agent up to date");
  expect(notice).toHaveTextContent("It'll use Model A today.");
  expect(save).toHaveBeenNthCalledWith(1, "a".repeat(64), {
    config: {
      instructions: "Be brief.",
      preset: "recommended",
      cutover: {
        answer: "auto_accepted",
        at: AT,
        mode: "toastAutoApplied",
        previous: { model: "model-x", effort: "low" },
      },
    },
    base: { settings: "head-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(save).toHaveBeenNthCalledWith(2, "a".repeat(64), {
    config: {
      model: "model-x",
      effort: "low",
      instructions: "Be brief.",
      cutover: { answer: "declined", at: AT, mode: "toastAutoApplied" },
    },
    base: { settings: "head-1" },
  });
});

it("toastAutoApplied: dismissing or Got it keeps the switch; a failed switch shows nothing and records nothing", async () => {
  for (const button of ["Got it", "Dismiss"]) {
    resetCutoverLaunch();
    withMode("toastAutoApplied", { acceptLabel: "Got it" });
    const saving = keeping();
    const made = fixture({ save: saving.save });
    saving.attach(made);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(made.save).toHaveBeenCalledTimes(1);
    made.view.unmount();
  }
  resetCutoverLaunch();
  withMode("toastAutoApplied");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const save = vi.fn(async () => {
      throw new Error("Connect to the community to save");
    });
    fixture({ save });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  } finally {
    warn.mockRestore();
  }
});

it("both kinds fill the agent's name and model into the title, and show what it would run on, as the Uses line does", async () => {
  for (const mode of ["toastAutoApplied", "optInPrompt"] as const) {
    resetCutoverLaunch();
    withMode(mode, { title: "{agent} on {model}", usesLabel: "Starting with" });
    const saving = keeping();
    const made = fixture({ save: saving.save });
    saving.attach(made);
    expect(
      await screen.findByText("Agent A on Model A", undefined, {
        timeout: 2000,
      }),
    ).toBeInTheDocument();
    const chip = screen.getByTitle("Codex: Model A · High");
    expect(chip).toHaveTextContent("Model A · High");
    expect(screen.getByText("Starting with")).toBeInTheDocument();
    expect(screen.getByTestId("harness-mark")).toBeInTheDocument();
    made.view.unmount();
  }
  // Without labels, the generic ones.
  resetCutoverLaunch();
  withMode("optInPrompt");
  fixture();
  expect(await screen.findByText("Uses")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
});

it("uses the offer's own Dismiss label", async () => {
  withMode("optInPrompt", { dismissLabel: "Close this" });
  fixture();
  expect(
    await screen.findByRole("button", { name: "Close this" }),
  ).toBeInTheDocument();
});

it("can't be closed while saving, and a second Yes saves nothing more", async () => {
  let finish = () => {};
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fixture({ save });
  await screen.findByRole("dialog");
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  const yes = screen.getByRole("button", { name: "Sounds good" });
  fireEvent.click(yes);
  // A second click while saving does nothing, even if it gets through.
  yes.removeAttribute("disabled");
  fireEvent.click(yes);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull(),
  );
  await act(async () => finish());
  expect(save).toHaveBeenCalledTimes(1);
  const [[, { config }]] = save.mock.calls as unknown as [
    [string, { config: object }],
  ];
  expect(config).toMatchObject({ cutover: { answer: "accepted" } });
});

it("toastAutoApplied: a slow switch still ends with the notice, and a remount keeps it", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    withMode("toastAutoApplied", { acceptLabel: "Got it" });
    let finish = () => {};
    let update = (_next: readonly Agent[]) => {};
    const made = fixture({
      save: vi.fn(
        (_key: string, { config }: { config: object }) =>
          new Promise<void>((resolve) => {
            finish = () => {
              update([agent({ config: config as Agent["config"] })]);
              resolve();
            };
          }),
      ),
    });
    update = made.update;
    await waitFor(() => expect(made.save).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(SAVE_MS + 1000);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => finish());
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Keep your agent up to date",
    );
    // Remounted in the same launch: the notice is still there, and nothing
    // is switched again.
    made.view.unmount();
    render(<AutomaticCutover agents={made.service} />, {
      wrapper: ToastProvider,
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(made.save).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("toastAutoApplied: remounted while its switch is saving, it still shows the notice", async () => {
  withMode("toastAutoApplied", { acceptLabel: "Got it" });
  let finish = () => {};
  let update = (_next: readonly Agent[]) => {};
  const made = fixture({
    save: vi.fn(
      (_key: string, { config }: { config: object }) =>
        new Promise<void>((resolve) => {
          finish = () => {
            update([agent({ config: config as Agent["config"] })]);
            resolve();
          };
        }),
    ),
  });
  update = made.update;
  await waitFor(() => expect(made.save).toHaveBeenCalledTimes(1));
  made.view.unmount();
  render(<AutomaticCutover agents={made.service} />, {
    wrapper: ToastProvider,
  });
  await act(async () => finish());
  expect(await screen.findByRole("dialog")).toHaveTextContent(
    "Keep your agent up to date",
  );
  expect(made.save).toHaveBeenCalledTimes(1);
});

it("toastAutoApplied checks again before switching: a second agent that appeared meanwhile stops it", async () => {
  withMode("toastAutoApplied");
  let release = (_ready: boolean) => {};
  let held = false;
  const { save, update } = fixture({
    ready: () =>
      new Promise<boolean>((resolve) => {
        held = true;
        release = resolve;
      }),
  });
  // Matched with one agent; while its harness check runs, a second appears.
  await waitFor(() => expect(held).toBe(true));
  act(() =>
    update([agent(), agent({ pubkey: "c".repeat(64), name: "Agent C" })]),
  );
  await act(async () => release(true));
  await settle();
  expect(save).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("offers nothing once the start-up window has passed", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    // The setup became final, but the agents only loaded after the window.
    const made = fixture({ agents: [] });
    await vi.advanceTimersByTimeAsync(CUTOVER_WINDOW_MS + 1000);
    act(() => made.update([agent()]));
    await vi.advanceTimersByTimeAsync(50);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(made.save).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("toastAutoApplied: the notice closes when another device undoes the switch", async () => {
  withMode("toastAutoApplied");
  let update = (_next: readonly Agent[]) => {};
  const made = fixture({
    save: vi.fn(async (_key: string, { config }: { config: object }) => {
      update([agent({ config: config as Agent["config"] })]);
    }),
  });
  update = made.update;
  await screen.findByRole("dialog");
  act(() =>
    made.update([
      agent({ config: { model: "model-x", cutover: { answer: "declined" } } }),
    ]),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(made.save).toHaveBeenCalledTimes(1);
});

it("toastAutoApplied: when the switch lands but its save reports a problem, the notice still shows", async () => {
  withMode("toastAutoApplied", { acceptLabel: "Got it" });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    let update = (_next: readonly Agent[]) => {};
    const made = fixture({
      // Saved, but the read-back failed: the switch arrives anyway.
      save: vi.fn(async (_key: string, { config }: { config: object }) => {
        update([agent({ config: config as Agent["config"] })]);
        throw new Error("Saved, but the current version couldn't be read back");
      }),
    });
    update = made.update;
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Keep your agent up to date",
    );
    expect(screen.getByRole("button", { name: "Opt out" })).toBeEnabled();
    expect(made.save).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});
