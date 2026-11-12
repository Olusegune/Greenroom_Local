import { useEffect, useState } from "react";
import { api } from "./api";

/** True when the on-this-PC sound engine and its model are installed. Re-checks when `again` changes. */
export function useLocalSfxReady(again: unknown = 0): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => { void api.sfxReady().then(setReady).catch(() => setReady(false)); }, [again]);
  return ready;
}
