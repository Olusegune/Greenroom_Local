import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, inApp, type FfmpegStatus } from "../api";
import { encodeWav, fmtTime, fromBase64, lineFileName, planTimeline, renderPlan, stemSets, textBase64, toBase64, type Plan } from "../audio";
import { fpsLabel, fpsOf, frameToSec, tcAt } from "../picture";
import { useApp } from "../ctx";
import { chosenTake } from "../direct";
import { qualityFormat, soundEngineOf } from "../engines";
import { makeSound } from "../generate";
import { applyGain, fmtDb, fmtLufs, measure, planNormalization, TARGETS, type Measure } from "../loudness";
import { audacityLabels, buildMarkers, cueSheetCsv, edl, otioTimeline } from "../markers";
import { productionReportMd, projectRights, rightsCsv, rightsSummary, sha256Hex } from "../trust";
import { APP_VERSION } from "../version";
import { stopPlayback, takeAudio, takeBuffer, takeUrl } from "../media";
import { audioPlan } from "../preview";
import { DEFAULT_EXPORT, type ExportCfg } from "../types";
import { Empty, Note, PlayButton, useBusy } from "../ui";

const RATES: ExportCfg["rate"][] = [44100, 48000, 96000];

export default function Export() {
  const { project, edit, confirmSpend, toast, go, keys, engines, library, priceLines, addLedger } = useApp();
  const { busy, run } = useBusy();
  const [made, setMade] = useState<string[]>([]);
  const [bedSecs, setBedSecs] = useState(12);
  const [stat, setStat] = useState<{ m: Measure; seconds: number; rate: number } | null>(null);
  const [step, setStep] = useState("");
  const [report, setReport] = useState<string>("");
  const [sync, setSync] = useState<string>("");
  const [ff, setFf] = useState<FfmpegStatus | null>(null);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [videoOut, setVideoOut] = useState<{ path: string; codec: string } | null>(null);
  const hasPicture = !!project?.picture;
  useEffect(() => {
    if (hasPicture) void api.ffmpegStatus().then(setFf).catch(() => setFf({ installed: false, source: null }));
  }, [hasPicture]);
  if (!project) return null;

  const cfg: ExportCfg = { ...DEFAULT_EXPORT, ...(project.export ?? {}) };
  const set = (p: Partial<ExportCfg>) => edit((pr) => ({ ...pr, export: { ...DEFAULT_EXPORT, ...(pr.export ?? {}), ...p } }));
  const target = TARGETS.find((t) => t.id === cfg.target) ?? TARGETS[0]!;

  const pic = project.picture;
  const plan = planTimeline(project, undefined, { exactTotal: pic && cfg.matchPicture && pic.duration > 0 ? pic.duration : undefined });
  const missing = project.lines.filter((l) => !chosenTake(l));
  const stem = project.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "Greenroom";
  const chosen = project.lines.map(chosenTake).filter((t): t is NonNullable<typeof t> => !!t);
  const lossy = chosen.filter((t) => t.ext === "mp3").length;

  if (project.lines.length === 0) {
    return (
      <section>
        <h1>Export</h1>
        <Empty
          title="Nothing to export yet"
          action={
            <button className="primary" onClick={() => go("write")}>
              Write the script
            </button>
          }
        >
          Write a script and make some takes first.
        </Empty>
      </section>
    );
  }

  const makeBed = async () => {
    if (!project.bed.prompt.trim()) return;
    const price = priceLines([{ kind: "sound", count: 1 }]);
    const ok = await confirmSpend({ title: "Make the atmosphere?", lines: [`"${project.bed.prompt.trim()}", ${bedSecs} seconds, looped under the scene`, `Uses ${soundEngineOf(engines).label} credits`, ...price.lines], warn: price.warn });
    if (!ok) return;
    await run(async () => {
      try {
        const elevenOptions = soundEngineOf(engines).id === "elevenlabs" ? { loop: true, promptInfluence: 0.3, sfxModel: engines.elevenSfxModel ?? "eleven_text_to_sound_v3" } : {};
        const t = await makeSound(project.id, project.bed.prompt.trim(), bedSecs, qualityFormat(engines.quality), soundEngineOf(engines).provider, elevenOptions);
        addLedger({ kind: "sound", engine: soundEngineOf(engines).ledger, chars: project.bed.prompt.trim().length, items: [{ kind: "sound", count: 1 }], note: "atmosphere" });
        edit((p) => ({ ...p, bed: { ...p.bed, take: t } }));
      } catch (e) {
        toast((e as Error).message, true);
      }
    });
  };

  const load = (ref: { id: string }) => takeBuffer(project.id, ref.id);
  const render = (pl: Plan, filter?: Parameters<typeof renderPlan>[4]) => renderPlan(pl, project.bed.volume, load, cfg.rate, filter);

  const analyze = () =>
    run(async () => {
      try {
        setStep("Measuring the mix…");
        const main = await render(plan);
        setStat({ m: measure(main, cfg.rate), seconds: plan.total, rate: cfg.rate });
      } catch (e) {
        toast((e as Error).message, true);
      }
      setStep("");
    });

  const doExport = () =>
    run(async () => {
      const out: string[] = [];
      const written: Record<string, string> = {};
      // With a picture, the file says which timecode its first sample belongs to, so an editor can place it by timecode.
      const wav = (markers?: { sec: number; name: string }[], tc = false) => ({ bits: cfg.bits, dither: cfg.bits === 16, markers, description: project.name, originator: "Greenroom", timeReference: tc && pic ? Math.round(frameToSec(pic.startFrame, fpsOf(pic)) * cfg.rate) : undefined });
      const hashes: string[] = [];
      const save = async (folder: string, name: string, b64: string) => {
        const p = await api.exportWrite(project.id, folder, name, b64);
        out.push(p);
        if (cfg.manifest) hashes.push(`${await sha256Hex(fromBase64(b64))} *${folder ? folder + "/" : ""}${name}`);
        return p;
      };
      try {
        setStep("Mixing…");
        const main = await render(plan);
        const m = measure(main, cfg.rate);
        const np = planNormalization(m, target.lufs, cfg.ceiling);
        const markers = buildMarkers(project, plan).map((k) => ({ sec: k.sec, name: k.name }));

        if (cfg.whole) {
          setStep("Writing the full scene…");
          await save("", `${stem} - full scene.wav`, toBase64(encodeWav(applyGain(main, np.gainDb), cfg.rate, wav(cfg.markersInWav ? markers : undefined, true))));
        }
        if (cfg.scenes) {
          for (let i = 0; i < project.scenes.length; i++) {
            const sp = audioPlan(project, i);
            if (sp.items.length === 0) continue;
            setStep(`Writing scene ${i + 1}…`);
            const ch = await render(sp);
            const title = project.scenes[i]!.replace(/[^\p{L}\p{N} _-]+/gu, "").trim();
            const mk = buildMarkers(project, sp).map((k) => ({ sec: k.sec, name: k.name }));
            await save("", `${stem} - scene ${i + 1} ${title}.wav`.replace(/ +/g, " "), toBase64(encodeWav(applyGain(ch, np.gainDb), cfg.rate, wav(cfg.markersInWav ? mk : undefined))));
          }
        }
        if (cfg.stems) {
          for (const s of stemSets(plan, project.characters)) {
            setStep(`Writing the ${s.name} stem…`);
            const ch = await render(plan, s.filter);
            await save("Stems", `${stem} - stem - ${s.name}.wav`.replace(/[^\p{L}\p{N} _.-]+/gu, ""), toBase64(encodeWav(applyGain(ch, np.gainDb), cfg.rate, wav(undefined, true))));
          }
        }
        if (cfg.lines || cfg.otio || cfg.edl) {
          setStep("Copying the original lines…");
          for (const [i, l] of project.lines.entries()) {
            const t = chosenTake(l);
            if (!t) continue;
            const who = project.characters.find((c) => c.id === l.characterId)?.name ?? "Line";
            const a = await takeAudio(project.id, t.id);
            written[t.id] = await save(`Lines - ${who}`, lineFileName(i, who, t.ext), a.audioB64);
          }
        }
        if (cfg.otio || cfg.edl) {
          for (const it of plan.items.filter((x) => x.kind !== "speech")) {
            const a = await takeAudio(project.id, it.ref.id);
            const mc = it.kind === "music" ? project.music?.find((m) => m.take.id === it.ref.id) : undefined;
            const safe = (mc?.name ?? "Music").replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "Music";
            const name = it.kind === "bed" ? `Atmosphere.${it.ref.ext}` : it.kind === "music" ? `${safe}.${it.ref.ext}` : `${it.ref.id}.${it.ref.ext}`;
            if (!written[it.ref.id]) written[it.ref.id] = await save(it.kind === "bed" ? "Atmosphere" : it.kind === "music" ? "Music" : "Sound clips", name, a.audioB64);
          }
        }
        if (cfg.labels) await save("", `${stem} - markers.txt`, textBase64(audacityLabels(buildMarkers(project, plan))));
        if (cfg.cueSheet) await save("", `${stem} - cue sheet.csv`, textBase64(cueSheetCsv(project, plan, cfg.fps, library, pic)));
        if (cfg.otio) await save("", `${stem}.otio`, textBase64(otioTimeline(project, plan, cfg.fps, written, pic)));
        if (cfg.edl) await save("", `${stem}.edl`, textBase64(edl(project, plan, cfg.fps, written, pic)));
        if (cfg.report) {
          const now = new Date().toISOString().slice(0, 16).replace("T", " ");
          await save("", `${stem} - production report.md`, textBase64(productionReportMd({ project, library, prices: engines.prices, appVersion: APP_VERSION, now })));
          await save("", `${stem} - rights register.csv`, textBase64(rightsCsv(projectRights(project, library))));
        }
        if (cfg.manifest && hashes.length) await save("", `${stem} - manifest.sha256.txt`, textBase64(hashes.join("\n") + "\n"));

        setMade(out);
        setSync(
          pic
            ? `Picture: ${pic.name} at ${fpsLabel(fpsOf(pic))}. The mix is ${plan.total.toFixed(3)} s (${Math.ceil(plan.total * cfg.rate)} samples at ${cfg.rate / 1000} kHz) against a picture of ${pic.duration.toFixed(3)} s. Its first sample is timecode ${tcAt(0, pic)}.`
            : "",
        );
        setReport(
          target.lufs === null
            ? `Level left as mixed: ${fmtLufs(m.lufs)}, true peak ${fmtDb(m.tpDb)} (estimate).`
            : np.reached
              ? `Brought from ${fmtLufs(m.lufs)} to ${fmtLufs(np.finalLufs)} (${np.gainDb >= 0 ? "+" : ""}${np.gainDb.toFixed(1)} dB). True peak ${fmtDb(np.finalTpDb)} (estimate).`
              : `Could not reach ${target.lufs} LUFS without passing the ${cfg.ceiling} dBTP ceiling. Mixed at ${fmtLufs(np.finalLufs)} instead (${np.gainDb >= 0 ? "+" : ""}${np.gainDb.toFixed(1)} dB), true peak ${fmtDb(np.finalTpDb)} (estimate).`,
        );
        toast(`Exported ${out.length} file${out.length === 1 ? "" : "s"}.`);
      } catch (e) {
        toast((e as Error).message, true);
      }
      setStep("");
    });

  const getFfmpeg = () =>
    run(async () => {
      try {
        setStep("Downloading ffmpeg (about 115 MB)…");
        await api.ffmpegInstall();
        setFf(await api.ffmpegStatus());
        toast("ffmpeg is ready.");
      } catch (e) {
        toast((e as Error).message, true);
      }
      setStep("");
    });

  /** Mixes to exactly the picture's length, saves that mix, and writes a copy of the video with it as the sound. */
  const writeVideo = () =>
    run(async () => {
      if (!pic) return;
      try {
        setStep("Mixing to the picture…");
        const vplan = planTimeline(project, undefined, { exactTotal: pic.duration > 0 ? pic.duration : undefined });
        const main = await render(vplan);
        const m = measure(main, cfg.rate);
        const np = planNormalization(m, target.lufs, cfg.ceiling);
        const tc = Math.round(frameToSec(pic.startFrame, fpsOf(pic)) * cfg.rate);
        const name = `${stem} - mix for video.wav`;
        await api.exportWrite(project.id, "", name, toBase64(encodeWav(applyGain(main, np.gainDb), cfg.rate, { bits: cfg.bits, dither: cfg.bits === 16, description: project.name, originator: "Greenroom", timeReference: tc })));
        setStep("Writing the video (the picture is copied, not re-encoded)…");
        const r = await api.videoMux(project.id, pic.path, name, keepOriginal);
        setVideoOut(r);
        setMade((old) => [...old, r.path]);
        toast("Video written.");
      } catch (e) {
        toast((e as Error).message, true);
      }
      setStep("");
    });

  const reveal = async (path: string) => {
    if (!inApp()) return;
    try {
      await revealItemInDir(path);
    } catch {
      toast("Could not open the folder.", true);
    }
  };

  const np = stat ? planNormalization(stat.m, target.lufs, cfg.ceiling) : null;
  const check = (k: keyof ExportCfg, label: string, hint?: string) => (
    <label key={k} className="row" style={{ alignItems: "flex-start" }}>
      <input type="checkbox" checked={cfg[k] as boolean} onChange={(e) => set({ [k]: e.target.checked } as Partial<ExportCfg>)} style={{ marginTop: 3 }} />
      <span>
        {label}
        {hint && <span className="muted small"> {hint}</span>}
      </span>
    </label>
  );

  return (
    <section>
      <div>
        <h1>Export</h1>
        <p className="lede">Mixes your chosen takes in order, with the levels, pauses and sound clips you set, and saves them in Documents\Greenroom. Choose the format, loudness and handoff files below.</p>
      </div>
      {rightsSummary(projectRights(project, library)).missing > 0 && (
        <Note kind="warn">
          {rightsSummary(projectRights(project, library)).missing} cloned voice{rightsSummary(projectRights(project, library)).missing === 1 ? " has" : "s have"} no consent record. You can still export; the production report will list it.{" "}
          <button className="sm" onClick={() => go("voices")}>
            Add it in Voices
          </button>
        </Note>
      )}
      {missing.length > 0 && (
        <Note kind="warn">
          {missing.length} line{missing.length === 1 ? " has" : "s have"} no take and will be left out.{" "}
          <button className="sm" onClick={() => go("perform")}>
            Back to Perform
          </button>
        </Note>
      )}

      <div className="card stack">
        <h2>Atmosphere (optional)</h2>
        <p className="muted small">A quiet sound under the whole scene, such as rain, a busy market or a kitchen. It loops and fades out at the end.</p>
        <div className="row wrap">
          <input type="text" aria-label="Describe the atmosphere" placeholder="Soft rain on a window, distant thunder" value={project.bed.prompt} onChange={(e) => edit((p) => ({ ...p, bed: { ...p.bed, prompt: e.target.value } }))} style={{ flex: 1, minWidth: 220 }} />
          <select aria-label="Length of the loop" value={bedSecs} onChange={(e) => setBedSecs(Number(e.target.value))}>
            {[6, 12, 22].map((s) => (
              <option key={s} value={s}>
                {s}s loop
              </option>
            ))}
          </select>
          <button onClick={() => void makeBed()} disabled={busy || !project.bed.prompt.trim() || !keys[soundEngineOf(engines).key]}>
            {project.bed.take ? "Make another" : "Make atmosphere"}
          </button>
        </div>
        {project.bed.take && (
          <div className="row wrap">
            <PlayButton label="Hear it" get={() => takeUrl(project.id, project.bed.take!.id)} />
            <label className="row small muted">
              Volume
              <input type="range" min={0} max={1} step={0.05} value={project.bed.volume} aria-label="Atmosphere volume" onChange={(e) => edit((p) => ({ ...p, bed: { ...p.bed, volume: Number(e.target.value) } }))} />
              <span className="num">{Math.round(project.bed.volume * 100)}%</span>
            </label>
            <button className="sm ghost" onClick={() => edit((p) => ({ ...p, bed: { ...p.bed, take: undefined } }))}>
              Remove
            </button>
          </div>
        )}
      </div>

      {pic && (
        <div className="card stack">
          <h2>Picture</h2>
          <p className="muted small">
            {pic.name} · {fpsLabel(fpsOf(pic))} · starts at {tcAt(0, pic)} · {pic.duration.toFixed(3)} s. Lines you placed on the Picture screen keep their exact times in every file, and the cue sheet and editor timeline use this frame rate and start timecode.
          </p>
          {check("matchPicture", "Make the mix exactly as long as the picture", "So the file drops onto the video from its first frame to its last. Anything placed after the picture ends is cut off.")}
          <h3 style={{ marginTop: 8 }}>A video with the new sound</h3>
          <p className="muted small">Writes a copy of your video with the Greenroom mix as its sound, so you can watch or send it as one file. The picture is copied without re-encoding and your original is never changed. The mix is made as long as the picture, at the loudness target above. The result goes in the project&apos;s exports folder, under Video.</p>
          {ff && !ff.installed ? (
            <Note>
              This needs ffmpeg, a free video tool. Greenroom can download it once (about 115 MB) from its public release and checks it against a fixed fingerprint before using it.{" "}
              <button className="sm" onClick={() => void getFfmpeg()} disabled={busy}>
                Download ffmpeg
              </button>
            </Note>
          ) : (
            <div className="row wrap">
              <label className="row small">
                <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} /> Keep the video&apos;s own sound as a second track
              </label>
              <span className="spacer" />
              <button className="primary" onClick={() => void writeVideo()} disabled={busy || !ff || plan.items.length === 0}>
                Write the video
              </button>
            </div>
          )}
          {ff?.source === "system" && <p className="muted small">Using the copy of ffmpeg already on this computer.</p>}
          {videoOut && (
            <p className="small" aria-live="polite">
              Saved with {videoOut.codec} sound.{" "}
              <button className="sm" onClick={() => void reveal(videoOut.path)}>
                Show in folder
              </button>
            </p>
          )}
          <p className="muted small">The sound is stored as AAC for MP4, 24-bit PCM for MOV, and lossless FLAC for other types. The start timecode of the original video is not carried into the new file.</p>
        </div>
      )}

      <div className="card stack">
        <h2>Format and loudness</h2>
        <div className="row wrap">
          <label className="field">
            Sample rate
            <select value={cfg.rate} onChange={(e) => set({ rate: Number(e.target.value) as ExportCfg["rate"] })}>
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r / 1000} kHz{r === 48000 ? " (film and video standard)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Bit depth
            <select value={cfg.bits} onChange={(e) => set({ bits: Number(e.target.value) as ExportCfg["bits"] })}>
              <option value={24}>24-bit (recommended)</option>
              <option value={32}>32-bit float</option>
              <option value={16}>16-bit (with dither)</option>
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 260 }}>
            Loudness target
            <select value={cfg.target} onChange={(e) => set({ target: e.target.value })}>
              {TARGETS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Peak ceiling
            <select value={cfg.ceiling} onChange={(e) => set({ ceiling: Number(e.target.value) })} disabled={target.lufs === null}>
              {[-1, -2, -3].map((c) => (
                <option key={c} value={c}>
                  {c} dBTP
                </option>
              ))}
            </select>
          </label>
        </div>
        {lossy > 0 && (
          <p className="muted small">
            {lossy} of {chosen.length} takes are MP3, a lossy format. The mix is still written cleanly at the chosen rate and depth, but it cannot add detail the source never had. For pro work set Audio quality to a lossless WAV on the Engines page (ElevenLabs Pro plan) and make new takes.
          </p>
        )}
        <p className="muted small">Loudness uses the ITU-R BS.1770 method. One steady gain is applied to the mix and to every stem, so they still add up. There is no limiter: if the peak ceiling stops the gain, the result says so. The true-peak figure is an estimate, not a certified meter.</p>
        <div className="row wrap">
          <button onClick={() => void analyze()} disabled={busy || plan.items.length === 0}>
            Measure the mix
          </button>
          {stat && (
            <span className="row wrap small" aria-live="polite">
              <span className="badge">{fmtTime(stat.seconds)} long</span>
              <span className="badge accent">{fmtLufs(stat.m.lufs)}</span>
              <span className="badge">true peak {fmtDb(stat.m.tpDb)}</span>
              <span className="badge">peak {fmtDb(stat.m.peakDb)}</span>
              {np && target.lufs !== null && Number.isFinite(stat.m.lufs) && (
                <span className={np.reached ? "badge ok" : "badge warn"}>
                  {np.reached ? `will become ${fmtLufs(np.finalLufs)}` : `limited to ${fmtLufs(np.finalLufs)} by the peak ceiling`}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="card stack">
        <h2>What to save</h2>
        {check("whole", "One file with the whole scene mixed")}
        {check("scenes", "One file for each scene")}
        {check("stems", "Stems: a track for each character, sound clips and atmosphere", "All the same length, so they line up and add back to the mix.")}
        {check("lines", "Every line as its own original file, in a folder for each character", "Untouched takes, without level or loudness changes.")}
        <details className="fold">
          <summary>
            <strong>For other software</strong> <span className="muted small">markers, label track, cue sheet, editor timeline</span>
          </summary>
          <div className="stack" style={{ marginTop: 10 }}>
        {check("markersInWav", "Markers inside the WAV files", "One at the start of each line. Shown by Audition, Reaper, Pro Tools and most editors.")}
        {check("labels", "A label track (.txt)", "Imports into Audacity and Reaper.")}
        {check("cueSheet", "A cue sheet (.csv)", "Every line with its timecode, voice, model and text.")}
        {check("edl", "A cut list (.edl)", "The classic CMX 3600 list that most editing and audio programs can conform from. One event for each clip, at its timecode.")}
        {check("otio", "A timeline for editors (.otio)", "A track for each stem with clips at their exact times, plus the video if you added one. Includes the original files it points to.")}
          </div>
        </details>
        <details className="fold">
          <summary>
            <strong>For producers and legal</strong> <span className="muted small">report, rights register, integrity manifest</span>
          </summary>
          <div className="stack" style={{ marginTop: 10 }}>
        {check("report", "Production report and rights register", "AI disclosure, voices and consent, estimated cost, every take with its fingerprint.")}
        {check("manifest", "Integrity manifest", "The SHA-256 of every file saved, so a changed file can be spotted later.")}
          </div>
        </details>
        {cfg.otio || cfg.edl || cfg.cueSheet ? (
          <label className="field" style={{ maxWidth: 220 }}>
            Frame rate for timecode
            <select value={cfg.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
              {[24, 25, 30].map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="muted small num">
          {plan.items.filter((i) => i.kind === "speech").length} lines, about {fmtTime(plan.total)} long.
        </p>
        <div className="row wrap">
          <button className="primary" disabled={busy || plan.items.length === 0 || !(cfg.whole || cfg.scenes || cfg.stems || cfg.lines || cfg.labels || cfg.cueSheet || cfg.otio || cfg.edl || cfg.report)} onClick={() => void doExport()}>
            {busy ? "Exporting…" : "Export"}
          </button>
          <button
            onClick={() => {
              stopPlayback();
              void import("../preview").then((m) => m.previewScene(project, () => undefined)).catch((e: Error) => toast(e.message, true));
            }}
            disabled={plan.items.length === 0}
          >
            Listen first
          </button>
          {step && (
            <span className="muted small" role="status">
              {step}
            </span>
          )}
        </div>
      </div>

      {made.length > 0 && (
        <div className="card stack lit" aria-live="polite">
          <h2>Saved</h2>
          {report && <p className="small">{report}</p>}
          {sync && <p className="small">{sync}</p>}
          {made.map((p) => (
            <div key={p} className="row between small">
              <code style={{ wordBreak: "break-all" }}>{p}</code>
              <button className="sm" onClick={() => void reveal(p)}>
                Show in folder
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
