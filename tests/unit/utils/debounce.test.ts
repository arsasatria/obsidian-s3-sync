import { describe, expect, it, vi } from "vitest";
import { debounce } from "../../../src/utils/debounce";

describe("debounce", () => {
  it("coalesces rapid calls", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const wrapped = debounce(spy, 100);

    wrapped("a" as never);
    wrapped("b" as never);
    vi.advanceTimersByTime(99);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("b");
    vi.useRealTimers();
  });
});
