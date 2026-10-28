import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, inApp } from "../api";
import { fromBase64, textBase64 } from "../audio";
import { Avatar } from "../avatar";
import { useApp } from "../ctx";
import { chosenTake } from "../direct";
import { DEFAULT_PRICES, ENGINES, type Engine, type Prices } from "../engines";
import { Empty, Note, useBusy } from "../ui";
import { budgetView, ledgerByEngine, ledgerTotal, money, productionReportMd, projectRights, rightsCsv, rightsSummary, sha256Hex, shortHash } from "../trust";
import { takeAudio } from "../media";
import { APP_VERSION } from "../version";

const PAID: Engine[] = ["elevenlabs", "voicekiller", "kie"];

export default function Studio() {
  const { project, library, engines, saveEngines, edit, go, toast } = useApp();
  const { busy, run } = useBusy();
  const [checked, setChecked] = useState<Record<string, "ok" | "changed" | "missing">>({});
  const [saved, setSaved] = useState<string[]>([]);
  if (!project) {
    return (
      <section>
        <h1>Studio</h1>
        <Empty
          title="Open a project first"
          action={
            <button className="primary" onClick={() => go("home")}>
              Go to Projects
            </button>
          }
        >
          Rights, cost and take history belong to a project.
        </Empty>
      </section>
    );
  }

  const prices: Prices = { ...DEFAULT_PRICES, ...(engines.prices ?? {}) };
  const setPrices = (p: Partial<Prices>) => saveEngines({ ...engines, prices: { ...prices, ...p } });
  const setKPrice = (e: Engine, v: string) => setPrices({ perKChars: { ...prices.perKChars, [e]: v === "" ? undefined : Math.max(0, Number(v)) } });

  const rows = projectRights(project, library);
  const sum = rightsSummary(rows);
  const bv = budgetView(project.budget, project.ledger, 0);
  const byEngine = ledgerByEngine(project.ledger);
  const total = ledgerTotal(project.ledger);
  const takes = project.lines.map((l, i) => ({ l, i, t: chosenTake(l) })).filter((x): x is { l: typeof x.l; i: number; t: NonNullable<typeof x.t> } => !!x.t);

  const verify = () =>
    run(async () => {
      const out: typeof checked = {};
      for (const { t } of takes) {
        if (!t.provenance?.sha256) continue;
        try {
          const a = await takeAudio(project.id, t.id);
          out[t.id] = (await sha256Hex(fromBase64(a.audioB64))) === t.provenance.sha256 ? "ok" : "changed";
        } catch {
          out[t.id] = "missing";
        }
      }
      setChecked(out);
      const bad = Object.values(out).filter((v) => v !== "ok").length;
      toast(bad === 0 ? `All ${Object.keys(out).length} fingerprints match.` : `${bad} take${bad === 1 ? "" : "s"} no longer match or are missing.`, bad > 0);
    });

  const saveReport = () =>
    run(async () => {
      try {
        const stem = project.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "Greenroom";
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const md = productionReportMd({ project, library, prices, appVersion: APP_VERSION, now });
        const a = await api.exportWrite(project.id, "", `${stem} - production report.md`, textBase64(md));
        const b = await api.exportWrite(project.id, "", `${stem} - rights register.csv`, textBase64(rightsCsv(rows)));
        setSaved([a, b]);
        toast("Production report saved.");
      } catch (e) {
        toast((e as Error).message, true);
      }
    });

  const reveal = async (p: string) => {
    if (!inApp()) return;
    try {
      await revealItemInDir(p);
    } catch {
      toast("Could not open the folder.", true);
    }
  };

  const fingerprinted = takes.filter((x) => x.t.provenance?.sha256).length;
  const over = bv.budget !== null && bv.spent > bv.budget;
  const priceField = (label: string, value: number | undefined, on: (v: string) => void, step = 0.001) => (
    <label key={label} className="field">
      {label}
      <input type="number" min={0} step={step} value={value || ""} onChange={(e) => on(e.target.value)} placeholder="unknown" />
    </label>
  );

  return (
    <section>
      <div>
        <h1>Studio</h1>
        <p className="lede">Rights, cost and take history for this project. It records and warns; it never stops you working.</p>
      </div>

      <div className="stats" role="group" aria-label="Summary">
        <div className={sum.missing ? "stat warn" : "stat"}>
          <span className="stat-n">{rows.length}</span>
          <span className="stat-l">voice{rows.length === 1 ? "" : "s"} used</span>
          <span className="stat-s">{sum.missing ? `${sum.missing} need consent` : sum.review ? `${sum.review} to review` : "all clear"}</span>
        </div>
        <div className={over ? "stat warn" : "stat"}>
          <span className="stat-n">{money(total, prices.currency)}</span>
          <span className="stat-l">estimated spend</span>
          <span className="stat-s">{bv.budget !== null ? (over ? "over budget" : `${money(bv.left ?? 0, prices.currency)} left`) : "no budget set"}</span>
        </div>
        <div className="stat">
          <span className="stat-n">{takes.length}</span>
          <span className="stat-l">take{takes.length === 1 ? "" : "s"} in use</span>
          <span className="stat-s">{fingerprinted} fingerprinted</span>
        </div>
      </div>

      <div className="card stack">
        <div className="row between wrap">
          <h2>Voice rights</h2>
          <button className="sm" onClick={() => go("voices")}>
            Edit rights in Voices
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="muted small">No voices are used in this project yet.</p>
        ) : (
          <div className="stack" style={{ gap: 0 }}>
            {rows.map((r) => {
              const v = library.find((x) => x.id === r.voiceId);
              return (
                <div key={r.voiceId + r.engine} className="right-row">
                  <Avatar seed={r.voiceId + r.name} gender={v?.gender} size={40} />
                  <span className="right-text">
                    <strong>{r.name}</strong>
                    <span className="muted small">
                      {ENGINES[r.engine].label} · {r.usedBy.join(", ")}
                    </span>
                    <span className="muted small">
                      {r.consent ? `Consent: ${r.consent.speaker}` : "No consent record"} · {r.licence === "commercial" ? "commercial use cleared" : r.licence === "personal" ? "personal use only" : "commercial use not noted"}
                    </span>
                    {r.issues.map((i) => (
                      <span key={i} className="small" style={{ color: "var(--warn)" }}>
                        {i}
                      </span>
                    ))}
                  </span>
                  <span className={r.level === "clear" ? "badge ok" : r.level === "missing" ? "badge warn" : "badge"}>{r.level === "missing" ? "consent needed" : r.level === "review" ? "to review" : "clear"}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <details className="card stack fold">
        <summary>
          <strong>Prices and budget</strong>{" "}
          <span className="muted small">{bv.budget !== null ? `budget ${money(bv.budget, prices.currency)}` : "enter your prices to see estimates"}</span>
        </summary>
        <p className="muted small">Greenroom cannot see your prices. Enter what your plans cost to see estimates and a budget warning. Leave a price empty if you do not know it: only characters are counted then. Offline engines are free.</p>
        <div className="price-grid">
          <label className="field">
            Currency
            <input type="text" value={prices.currency} maxLength={4} onChange={(e) => setPrices({ currency: e.target.value.toUpperCase() })} />
          </label>
          <label className="field">
            Budget for this project
            <input type="number" min={0} step={0.5} value={project.budget ?? ""} onChange={(e) => edit((p) => ({ ...p, budget: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) }))} placeholder="no limit" />
          </label>
        </div>
        <h3>Speech, per 1,000 characters</h3>
        <div className="price-grid">{PAID.map((e) => priceField(ENGINES[e].label, prices.perKChars[e], (v) => setKPrice(e, v)))}</div>
        <h3>Everything else, each</h3>
        <div className="price-grid">
          {priceField("Sound clip", prices.sfxClip, (v) => setPrices({ sfxClip: Math.max(0, Number(v)) }))}
          {priceField("AI Director call", prices.directorCall, (v) => setPrices({ directorCall: Math.max(0, Number(v)) }))}
          {priceField("Voice design preview", prices.designPreview, (v) => setPrices({ designPreview: Math.max(0, Number(v)) }))}
          {priceField("Music request (Suno)", prices.musicRun, (v) => setPrices({ musicRun: Math.max(0, Number(v)) }))}
        </div>
        {bv.budget !== null && (
          <div>
            <div className="progress" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (bv.spent / bv.budget) * 100)}%`, background: over ? "var(--err)" : undefined }} />
            </div>
            <p className={over ? "err-text small" : "muted small"} role="status">
              {money(bv.spent, prices.currency)} spent of {money(bv.budget, prices.currency)}
              {over ? ": over budget." : `, ${money(bv.left ?? 0, prices.currency)} left.`}
            </p>
          </div>
        )}
        {byEngine.length === 0 ? (
          <p className="muted small">Nothing has been generated with a paid engine in this project yet.</p>
        ) : (
          <div className="stack">
            <h3>Spent so far (estimate {money(total, prices.currency)})</h3>
            {byEngine.map((e) => (
              <div key={e.engine} className="row between small">
                <span>{e.engine}</span>
                <span className="muted num">
                  {e.count} request{e.count === 1 ? "" : "s"} · {e.chars} characters · {e.cost > 0 ? money(e.cost, prices.currency) : "price not set"}
                </span>
              </div>
            ))}
          </div>
        )}
        {(project.ledger ?? []).length > 0 && (
          <details className="small muted">
            <summary>Recent activity</summary>
            <div className="stack" style={{ gap: 2, marginTop: 6 }}>
              {[...(project.ledger ?? [])].reverse().slice(0, 25).map((e, i) => (
                <span key={i} className="num">
                  {e.at.slice(0, 16).replace("T", " ")} · {e.kind} · {e.engine} · {e.chars} chars{e.cost > 0 ? ` · ${money(e.cost, prices.currency)}` : ""}{e.note ? ` · ${e.note}` : ""}
                </span>
              ))}
            </div>
          </details>
        )}
      </details>

      <details className="card stack fold">
        <summary>
          <strong>Where each take came from</strong> <span className="muted small">{takes.length} take{takes.length === 1 ? "" : "s"}, each with a fingerprint</span>
        </summary>
        <div className="row between wrap">
          <p className="muted small" style={{ flex: 1, minWidth: 220, margin: 0 }}>
            Every take keeps what produced it and a fingerprint of the audio file. Checking re-reads each file and reports a changed or missing one.
          </p>
          <button onClick={() => void verify()} disabled={busy || takes.length === 0}>
            {busy ? "Checking…" : "Check the fingerprints"}
          </button>
        </div>
        {takes.length === 0 ? (
          <p className="muted small">No takes yet.</p>
        ) : (
          <div className="stack" style={{ gap: 4 }}>
            {takes.map(({ l, i, t }) => {
              const who = project.characters.find((c) => c.id === l.characterId)?.name ?? "";
              const p = t.provenance;
              const c = checked[t.id];
              return (
                <div key={t.id} className="row between small" style={{ alignItems: "flex-start" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="muted num">{i + 1}</span> <strong>{who}</strong> · {p?.voiceName ?? t.voiceId} · {p ? ENGINES[p.engine].label : "unknown engine"} / {t.model}
                    {p?.quality ? ` · ${p.quality}` : ""}
                  </span>
                  <span className="muted num">{t.at.slice(0, 16).replace("T", " ")}</span>
                  <code>{shortHash(p?.sha256)}</code>
                  {c && <span className={c === "ok" ? "badge ok" : "badge warn"}>{c === "ok" ? "matches" : c === "changed" ? "changed" : "missing"}</span>}
                </div>
              );
            })}
          </div>
        )}
      </details>

      <div className="card stack">
        <div className="row between wrap">
          <div>
            <h2>Production report</h2>
            <p className="muted small" style={{ margin: 0 }}>
              For a producer or legal team: what was made, which AI voices and on what rights, an AI disclosure, estimated cost, and a rights register spreadsheet.
            </p>
          </div>
          <button className="primary" onClick={() => void saveReport()} disabled={busy}>
            Save the production report
          </button>
        </div>
        {sum.missing > 0 && <Note kind="warn">{sum.missing} cloned voice{sum.missing === 1 ? " has" : "s have"} no consent record. The report will list that clearly.</Note>}
        {saved.map((p) => (
          <div key={p} className="row between small">
            <code style={{ wordBreak: "break-all" }}>{p}</code>
            <button className="sm" onClick={() => void reveal(p)}>
              Show in folder
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
