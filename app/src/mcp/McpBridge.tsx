import { useEffect, useRef } from "react";
import { api, inApp } from "../api";
import { useApp } from "../ctx";
import type { Project } from "../types";
import { handleTool } from "./tools";

/**
 * Listens for tool calls from the MCP server (an outside AI agent the owner switched on in Settings) and runs them with the app's own
 * code. It shows nothing itself: if a tool needs the person (a cost sheet, an approval), the app's normal sheet appears and the call
 * waits. It does nothing at all outside the installed app.
 */
export default function McpBridge() {
  const app = useApp();
  const appRef = useRef(app);
  appRef.current = app;
  const live = useRef<Project | null>(app.project);
  live.current = app.project;

  useEffect(() => {
    if (!inApp()) return;
    let stop: (() => void) | undefined;
    let dead = false;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const un = await listen<{ id: number; name: string; args: Record<string, unknown> }>("mcp-call", async (e) => {
        const { id, name, args } = e.payload;
        const a = appRef.current;
        try {
          const out = await handleTool(name, args ?? {}, { app: a, live, current: () => live.current });
          await api.mcpReply(id, true, out);
        } catch (err) {
          await api.mcpReply(id, false, (err as Error).message || "The tool failed.");
        }
      });
      if (dead) un();
      else stop = un;
    });
    return () => {
      dead = true;
      stop?.();
    };
  }, []);
  return null;
}
