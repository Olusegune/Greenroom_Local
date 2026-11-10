// Connects the Agent Studio's steps to the real app: the live project, the voice library, take generation, the cost ledger
// and take measuring. Paid work is confirmed before the agent starts (Autonomous) or per step (Guided); here a cloud take
// is only made when the run's own checks already allowed it, and its cost goes into the same ledger as any other take.

import type { MutableRefObject } from "react";
import { frameActivity } from "../analysis";
import { integratedLoudness } from "../loudness";
import type { Env } from "../agent/services";
import { countClipRuns, type Measured } from "../agent/quality";
import { interpret } from "../agent/brief";
import { readyEnginesFrom } from "../presets/cast";
import { DEFAULT_PRICES, ENGINES, qualityFormat, soundEngineOf } from "../engines";
import { api } from "../api";
import { renderPlan } from "../audio";
import { exportFullScene } from "../exportScene";
import { sha256Hex } from "../trust";
import { assembledFor, makeBeatTake, makeSound, makeTake } from "../generate";
import { takeBuffer } from "../media";
import { estimateCost } from "../trust";
import type { Project } from "../types";
import { dictFor } from "../voiceDna";
import { currentManifest } from "../avatarState";
import { assignPresetFaces } from "../presets/portraits";
import { STARTER_PRESETS } from "../presets";
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
    portraitFor: (() => { const m = assignPresetFaces(currentManifest(), STARTER_PRESETS); return (id: string) => m.get(id); })(),
    edit: (fn) => { live.current = fn(live.current!); edit(fn, "agent"); },
    async makeTake(line, voice) {
      const p = live.current!;
      const dna = p.characters.find((c) => c.id === line.characterId)?.dna;
      // The casting guard: the voice that is about to speak must be the one this character was approved with.
      const opts = { inworldModel: engines.inworldModel, casting: { character: p.characters.find((c) => c.id === line.characterId), library, context: { commercial: p.commercial === true } } };
      const make = assembledFor(line, voice, opts) ? makeBeatTake : makeTake;
      const take = await make(p.id, line, voice, engines.elevenModel, dictFor(p.pronunciations, dna), qualityFormat(engines.quality), opts);
      const cloud = !ENGINES[voice.provider].local;
      const chars = take.provenance?.chars ?? line.text.length;
      if (cloud) addLedger({ kind: "speech", engine: ENGINES[voice.provider].label, chars, items: [{ kind: "speech", engine: voice.provider, chars }], note: "Agent Studio" });
      return { take, spent: cloud ? estimateCost(prices, [{ kind: "speech", engine: voice.provider, chars }]).cost : 0 };
    },
    async makeSound(prompt, seconds) {
      const p = live.current!;
      const eng = soundEngineOf(engines);
      const opts = eng.id === "elevenlabs" ? { loop: false, promptInfluence: 0.3, sfxModel: engines.elevenSfxModel ?? "eleven_text_to_sound_v3" } : {};
      const t = await makeSound(p.id, prompt, Math.min(seconds, eng.maxSeconds ?? 22), qualityFormat(engines.quality), eng.provider, opts);
      let spent = 0;
      if (!eng.free) {
        addLedger({ kind: "sound", engine: eng.ledger, chars: prompt.length, items: [{ kind: "sound", count: 1 }], note: "Agent Studio" });
        spent = estimateCost(prices, [{ kind: "sound", count: 1 }]).cost;
      }
      return { take: { id: t.id, ext: t.ext, seconds: t.seconds, sha256: t.sha256, prompt }, spent };
    },
    async exportScene(project) {
      return exportFullScene(project, {
        render: (plan, bedVolume, rate) => renderPlan(plan, bedVolume, (ref) => takeBuffer(project.id, ref.id), rate),
        write: (name, b64) => api.exportWrite(project.id, "", name, b64),
        sha256: sha256Hex,
      });
    },
    async embed(takes) {
      const st = await api.speakerStatus();
      if (!st.ready) throw new Error("not installed");
      const rows = await api.speakerEmbed(live.current!.id, takes);
      return Object.fromEntries(rows.filter((r) => r.embedding).map((r) => [r.take, r.embedding!]));
    },
    async measure(take): Promise<Measured | null> {
      const b = await takeBuffer(live.current!.id, take.id);
      const x = b.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]!); if (a > peak) peak = a; }
      const clipRuns = countClipRuns(x);
      const { voiced } = frameActivity(x, b.sampleRate);
      return { peak, silenceRatio: voiced.length ? 1 - voiced.filter(Boolean).length / voiced.length : 0, seconds: x.length / b.sampleRate, lufs: integratedLoudness([x], b.sampleRate), clipRuns };
    },
  };
}
