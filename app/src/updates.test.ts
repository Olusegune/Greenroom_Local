import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = { check: vi.fn(), install: vi.fn() };
vi.mock("./api", () => ({ api: { updateCheck: (...a: unknown[]) => calls.check(...a), updateInstall: (...a: unknown[]) => calls.install(...a) } }));

import { checkForUpdates, getUpdateState, installUpdate, resetUpdates, subscribeUpdates, updateError } from "./updates";

beforeEach(() => {
  resetUpdates();
  calls.check.mockReset();
  calls.install.mockReset();
});

describe("update errors", () => {
  it("say whether it is the connection, the signature or the missing release", () => {
    expect(updateError(new Error("error sending request for url"))).toContain("internet connection");
    expect(updateError(new Error("the signature could not be verified"))).toContain("signature check");
    expect(updateError("Could not fetch a valid release JSON from the remote (status 404)")).toContain("No update information");
    expect(updateError("Invalid encoding in minisign data")).toContain("signature check");
    expect(updateError(new Error(""))).toBe("Could not check for updates.");
  });
});

describe("checking", () => {
  it("reports an available update and tells listeners", async () => {
    calls.check.mockResolvedValue({ version: "1.2.3", notes: "n", date: "d" });
    const seen: string[] = [];
    const off = subscribeUpdates(() => seen.push(getUpdateState().phase));
    expect((await checkForUpdates())?.version).toBe("1.2.3");
    off();
    expect(seen).toEqual(["checking", "available"]);
    expect(getUpdateState().info?.version).toBe("1.2.3");
  });
  it("says none when this is the newest, and an error in plain words when it fails", async () => {
    calls.check.mockResolvedValueOnce(null);
    await checkForUpdates();
    expect(getUpdateState().phase).toBe("none");
    calls.check.mockRejectedValueOnce(new Error("error sending request"));
    await checkForUpdates();
    expect(getUpdateState()).toMatchObject({ phase: "error", error: expect.stringContaining("internet") });
  });
  it("stays quiet about failures at start-up", async () => {
    calls.check.mockRejectedValueOnce(new Error("offline"));
    await checkForUpdates(true);
    expect(getUpdateState()).toMatchObject({ phase: "idle", error: "" });
  });
  it("does not start a second check while one is running", async () => {
    let release: (v: null) => void = () => undefined;
    calls.check.mockReturnValue(new Promise((r) => (release = r)));
    const a = checkForUpdates();
    await checkForUpdates();
    expect(calls.check).toHaveBeenCalledTimes(1);
    release(null);
    await a;
  });
});

describe("installing", () => {
  it("only installs after a check found something, and shows progress", async () => {
    await installUpdate();
    expect(calls.install).not.toHaveBeenCalled();
    calls.check.mockResolvedValue({ version: "2.0.0", notes: "", date: "" });
    await checkForUpdates();
    calls.install.mockImplementation(async (on: (d: number, t: number) => void) => {
      on(250, 1000);
      expect(getUpdateState()).toMatchObject({ phase: "installing", progress: 0.25 });
      on(5000, 1000);
      expect(getUpdateState().progress).toBe(1);
      on(10, 0);
      expect(getUpdateState().progress).toBe(-1);
    });
    await installUpdate();
    expect(calls.install).toHaveBeenCalledTimes(1);
  });
  it("shows a failed install as an error and leaves the app as it was", async () => {
    calls.check.mockResolvedValue({ version: "2.0.0", notes: "", date: "" });
    await checkForUpdates();
    calls.install.mockRejectedValue(new Error("signature verification failed"));
    await installUpdate();
    expect(getUpdateState()).toMatchObject({ phase: "error", error: expect.stringContaining("signature check") });
  });
});
