// Connects the Agent Studio's steps to the real app: the live project, the voice library, take generation, the cost ledger
// and take measuring. Paid work is confirmed before the agent starts (Autonomous) or per step (Guided); here a cloud take
// is only made when the run's own checks already allowed it, and its cost goes into the same ledger as any other take.

import type { MutableRefObject } from "react";
import { frameActivity } from "../analysis";
import type { Env } from "../agent/services";
import type { Measured } from "../agent/quality";
import { interpret } from "../agent/brief";
import { readyEnginesFrom } from "../presets/cast";
import { DEFAULT_PRICES, ENGINES, qualityFormat } from "../engines";
import { assembledFor, makeBeatTake, makeTake } from "../generate";
import { takeBuffer } from "../media";
import { estimateCost } from "../trust";
import type { Project } from "../types";
import { dictFor } from "../voiceDna";
import type { useApp } from "../ctx";

export function agentEnv({ app, live }: { app: ReturnType<typeof useApp>; live: MutableRefObject<Project | null> }): Env {
  const { engines, keys, library, edit, addLedger } = app;
  const prices = engines.prices ?? DEFAULT_PRICES;
  const brief = live.current?.agent?.brief ?? "";
  return {
    project: () => live.current!,
    library: () => library,
    ready: () => readyEnginesFrom(keys, library),
    localOnly: live.current?.agent?.localOnly !== false,
    interpretation: interpret(brief),
    edit: (fn) => { live.current = fn(live.current!); edit(fn, "agent"); },
    async makeTake(line, voice) {
      const p = live.current!;
      const dna = p.characters.find((c) => c.id === line.characterId)?.dna;
      const opts = { inworldModel: engines.inworldModel };
      const make = assembledFor(line, voice, opts) ? makeBeatTake : makeTake;
      const take = await make(p.id, line, voice, engines.elevenModel, dictFor(p.pronunciations, dna), qualityFormat(engines.quality), opts);
      const cloud = !ENGINES[voice.provider].local;
      const chars = take.provenance?.chars ?? line.text.length;
      if (cloud) addLedger({ kind: "speech", engine: ENGINES[voice.provider].label, chars, items: [{ kind: "speech", engine: voice.provider, chars }], note: "Agent Studio" });
      return { take, spent: cloud ? estimateCost(prices, [{ kind: "speech", engine: voice.provider, chars }]).cost : 0 };
    },
    async measure(take): Promise<Measured | null> {
      const b = await takeBuffer(live.current!.id, take.id);
      const x = b.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]!); if (a > peak) peak = a; }
      const { voiced } = frameActivity(x, b.sampleRate);
      return { peak, silenceRatio: voiced.length ? 1 - voiced.filter(Boolean).length / voiced.length : 0, seconds: x.length / b.sampleRate };
    },
  };
}
