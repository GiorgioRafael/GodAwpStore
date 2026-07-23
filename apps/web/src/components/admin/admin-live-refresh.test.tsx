import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  router: undefined as undefined | { refresh: ReturnType<typeof vi.fn> },
  removeChannel: vi.fn(),
  subscribeCallback: undefined as ((status: string) => void) | undefined,
  changeCallbacks: [] as Array<() => void>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => {
    const channel = {
      on: vi.fn((_type: string, _filter: unknown, callback: () => void) => {
        mocks.changeCallbacks.push(callback);
        return channel;
      }),
      subscribe: vi.fn((callback: (status: string) => void) => {
        mocks.subscribeCallback = callback;
        return channel;
      }),
    };
    return {
      channel: vi.fn(() => channel),
      removeChannel: mocks.removeChannel,
    };
  },
}));

import { AdminLiveRefresh } from "./admin-live-refresh";

describe("AdminLiveRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.router = { refresh: mocks.refresh };
    mocks.changeCallbacks.length = 0;
    mocks.subscribeCallback = undefined;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalida a rota com debounce após INSERT ou UPDATE", async () => {
    const view = render(<AdminLiveRefresh />);

    act(() => mocks.subscribeCallback?.("SUBSCRIBED"));
    expect(screen.getByLabelText("Painel interno: Ao vivo")).toBeInTheDocument();
    expect(mocks.changeCallbacks.length).toBeGreaterThanOrEqual(2);
    const callbacks = mocks.changeCallbacks.slice(-2);

    act(() => {
      callbacks[0]?.();
      callbacks[1]?.();
      vi.advanceTimersByTime(599);
    });
    expect(mocks.refresh).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/Atualiz/)).toBeInTheDocument();

    view.unmount();
    expect(mocks.removeChannel).toHaveBeenCalledOnce();
  });

  it("usa atualização periódica como fallback", () => {
    render(<AdminLiveRefresh />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
