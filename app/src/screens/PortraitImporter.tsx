import { useEffect, useRef, useState } from "react";
import { AGE_LABEL, AGES, HERITAGE_CHOICES, addCustom, type Age, type CustomAvatar, type Heritage } from "../avatarLibrary";
import { updateStore, useAvatars } from "../avatarState";
import { useApp } from "../ctx";
import { ACCEPT_ATTR, MAX_BATCH, MAX_CUSTOM, MAX_ENCODED_CHARS, checkFile, checkSize, cleanLook, cropRect, dHash, nameFromFile, nearDuplicate, readDimensions, sanitizeName, sniff } from "../importer";

interface Item {
  key: string;
  bmp: ImageBitmap;
  w: number;
  h: number;
  name: string;
  gender: "" | "m" | "f";
  age: Age | "";
  heritage: Heritage | "";
  auto: boolean;
  zoom: number;
  cx: number;
  cy: number;
  warning?: string;
  duplicate?: string;
  hash: string;
}

const AGE_CHOICES = AGES.filter((a) => a !== "ageless");
const toGray = (src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Uint8ClampedArray | null => {
  // shrink in two steps: going straight from a large picture to 9 x 8 skips most of its pixels and gives a different answer for the same face
  const mid = document.createElement("canvas");
  mid.width = mid.height = 64;
  const mg = mid.getContext("2d");
  if (!mg) return null;
  mg.imageSmoothingQuality = "high";
  mg.drawImage(src, sx, sy, sw, sh, 0, 0, 64, 64);
  const c = document.createElement("canvas");
  c.width = 9;
  c.height = 8;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.imageSmoothingQuality = "high";
  g.drawImage(mid, 0, 0, 64, 64, 0, 0, 9, 8);
  const d = g.getImageData(0, 0, 9, 8).data;
  const out = new Uint8ClampedArray(72);
  for (let i = 0; i < 72; i++) out[i] = Math.round(0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!);
  return out;
};

let builtinHashes: Promise<{ name: string; hash: string }[]> | null = null;
/** A hash of every built-in thumbnail, read once, so a picture that is already in the library can be recognised. */
function loadBuiltinHashes(list: { id: string; name: string; thumbnail: string }[]): Promise<{ name: string; hash: string }[]> {
  if (!builtinHashes)
    builtinHashes = Promise.all(
      list.map(
        (a) =>
          new Promise<{ name: string; hash: string } | null>((res) => {
            const im = new Image();
            im.onload = () => {
              const g = toGray(im, 0, 0, im.naturalWidth, im.naturalHeight);
              res(g ? { name: a.name, hash: dHash(g) } : null);
            };
            im.onerror = () => res(null);
            im.src = `./avatars/${a.thumbnail}`;
          }),
      ),
    ).then((r) => r.filter((x): x is { name: string; hash: string } => x !== null));
  return builtinHashes;
}

function Preview({ item }: { item: Item }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const r = cropRect(item.w, item.h, item.zoom, item.cx, item.cy);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(item.bmp, r.x, r.y, r.size, r.size, 0, 0, c.width, c.height);
  }, [item.bmp, item.w, item.h, item.zoom, item.cx, item.cy]);
  return <canvas ref={ref} width={150} height={150} aria-label="How the portrait will be cut" style={{ width: 150, height: 150, borderRadius: "50%", background: "var(--surface-3)", flex: "none" }} />;
}

/** Add portraits from this computer to "My avatars": check each file, cut it square, say who it shows, and add it. */
export function PortraitImporter({ onClose, onAdded }: { onClose: () => void; onAdded: (ids: string[]) => void }) {
  const { toast } = useApp();
  const { manifest, store } = useAvatars();
  const [items, setItems] = useState<Item[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  useEffect(() => () => itemsRef.current.forEach((i) => i.bmp.close()), []);

  const read = async (files: File[]) => {
    setBusy(true);
    const found: string[] = [];
    const next: Item[] = [];
    if (files.length > MAX_BATCH) found.push(`Only the first ${MAX_BATCH} pictures were read; add the rest in another batch.`);
    const known = [
      ...(manifest ? await loadBuiltinHashes(manifest.avatars.map((a) => ({ id: a.id, name: a.name, thumbnail: a.assets.thumbnail }))) : []),
      ...(
        await Promise.all(
          store.custom.map(
            (c) =>
              new Promise<{ name: string; hash: string } | null>((res) => {
                const im = new Image();
                im.onload = () => {
                  const g = toGray(im, 0, 0, im.naturalWidth, im.naturalHeight);
                  res(g ? { name: c.name, hash: dHash(g) } : null);
                };
                im.onerror = () => res(null);
                im.src = c.thumb;
              }),
          ),
        )
      ).filter((x): x is { name: string; hash: string } => x !== null),
    ];
    for (const file of files.slice(0, MAX_BATCH)) {
      const label = sanitizeName(file.name, "A file");
      try {
        const head = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
        const bad = checkFile(file, head);
        if (bad) {
          found.push(`${label}: ${bad}`);
          continue;
        }
        const type = sniff(head)!;
        const dim = readDimensions(head, type);
        if (!dim) {
          found.push(`${label}: the picture's size could not be read, so it was not opened.`);
          continue;
        }
        const first = checkSize(dim.w, dim.h);
        if (first.error) {
          found.push(`${label}: ${first.error}`);
          continue;
        }
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
        const second = checkSize(bmp.width, bmp.height);
        if (second.error) {
          bmp.close();
          found.push(`${label}: ${second.error}`);
          continue;
        }
        const r = cropRect(bmp.width, bmp.height, 1, 0.5, 0.5);
        const gray = toGray(bmp, r.x, r.y, r.size, r.size);
        const hash = gray ? dHash(gray) : "";
        const same = hash ? nearDuplicate(hash, [...known, ...next.map((n) => ({ name: n.name, hash: n.hash }))]) : null;
        next.push({ key: `${Date.now()}-${next.length}-${Math.random().toString(36).slice(2, 6)}`, bmp, w: bmp.width, h: bmp.height, name: nameFromFile(file.name), gender: "", age: "", heritage: "", auto: false, zoom: 1, cx: 0.5, cy: 0.5, warning: second.warning, duplicate: same ?? undefined, hash });
      } catch {
        found.push(`${label}: Greenroom could not read that picture.`);
      }
    }
    setItems((cur) => [...cur, ...next].slice(0, MAX_BATCH));
    setProblems(found);
    setBusy(false);
  };

  const patch = (key: string, p: Partial<Item>) =>
    setItems((cur) =>
      cur.map((i) => {
        if (i.key !== key) return i;
        const n = { ...i, ...p };
        // setting both a gender and an age turns automatic use on; it cannot be on without them
        if (p.auto === undefined && (p.gender !== undefined || p.age !== undefined)) n.auto = !!(n.gender && n.age);
        if (!n.gender || !n.age) n.auto = false;
        return n;
      }),
    );
  const remove = (key: string) =>
    setItems((cur) => {
      cur.find((i) => i.key === key)?.bmp.close();
      return cur.filter((i) => i.key !== key);
    });

  const encode = (i: Item, px: number, q: number): string => {
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    if (!g) throw new Error("Greenroom could not prepare that picture.");
    g.imageSmoothingQuality = "high";
    const r = cropRect(i.w, i.h, i.zoom, i.cx, i.cy);
    g.drawImage(i.bmp, r.x, r.y, r.size, r.size, 0, 0, px, px);
    return c.toDataURL("image/jpeg", q);
  };

  const add = async () => {
    if (!items.length) return;
    if (store.custom.length + items.length > MAX_CUSTOM) return toast(`My avatars can hold ${MAX_CUSTOM} pictures. Remove some first.`, true);
    setBusy(true);
    try {
      const made: CustomAvatar[] = items.map((i, n) => {
        const look = cleanLook({ gender: i.gender, age: i.age, heritage: i.heritage });
        const image = encode(i, 512, 0.86);
        const thumb = encode(i, 128, 0.8);
        if (image.length > MAX_ENCODED_CHARS || thumb.length > MAX_ENCODED_CHARS) throw new Error("A picture came out too large to keep.");
        return { id: `custom:${Date.now().toString(36)}${n}${Math.random().toString(36).slice(2, 6)}`, name: sanitizeName(i.name), createdAt: new Date().toISOString(), image, thumb, source: "imported", tags: [], gender: look.gender, age: look.age, heritage: look.heritage, auto: i.auto && !!look.gender && !!look.age };
      });
      await updateStore((s) => made.reduceRight((acc, a) => addCustom(acc, a), s));
      toast(made.length === 1 ? "Added to My avatars." : `Added ${made.length} portraits to My avatars.`);
      onAdded(made.map((m) => m.id));
      onClose();
    } catch (e) {
      toast((e as Error).message || "Greenroom could not add those pictures.", true);
      setBusy(false);
    }
  };

  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="pi-t" style={{ width: "min(860px, 96vw)", maxHeight: "92vh", overflow: "auto" }}>
        <h2 id="pi-t">Add portraits</h2>
        <p className="muted small">
          Choose PNG, JPEG or WebP pictures (up to {MAX_BATCH} at a time). Each is cut square, kept at 512 pixels, and stays on this computer. Say who it shows and a portrait can also be used as an automatic face for a voice. Pictures are never enlarged, and the file's own name and details are not kept.
        </p>
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <button className="primary" disabled={busy || items.length >= MAX_BATCH} onClick={() => input.current?.click()}>
            Choose pictures…
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            aria-label="Choose pictures"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (f.length) void read(f);
            }}
          />
          {busy && <span className="muted small">Reading…</span>}
        </div>
        {problems.length > 0 && (
          <ul className="small" style={{ color: "var(--warn, #ffd28a)", margin: "0 0 12px 18px" }} role="alert">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        <div className="stack" style={{ gap: 14 }}>
          {items.map((it) => (
            <div key={it.key} className="row wrap" style={{ alignItems: "flex-start", gap: 16, padding: 12, border: "1px solid var(--line)", borderRadius: 12 }}>
              <div className="stack" style={{ alignItems: "center", gap: 6 }}>
                <Preview item={it} />
                <span className="muted small">
                  {it.w} × {it.h}
                </span>
              </div>
              <div className="stack" style={{ flex: 1, minWidth: 260, gap: 8 }}>
                <label className="field">
                  Name
                  <input type="text" value={it.name} maxLength={60} onChange={(e) => patch(it.key, { name: e.target.value })} />
                </label>
                <div className="row wrap" style={{ gap: 8 }}>
                  <label className="field" style={{ minWidth: 130 }}>
                    Gender
                    <select value={it.gender} onChange={(e) => patch(it.key, { gender: e.target.value as Item["gender"] })}>
                      <option value="">Not set</option>
                      <option value="f">Woman or girl</option>
                      <option value="m">Man or boy</option>
                    </select>
                  </label>
                  <label className="field" style={{ minWidth: 140 }}>
                    Age
                    <select value={it.age} onChange={(e) => patch(it.key, { age: e.target.value as Item["age"] })}>
                      <option value="">Not set</option>
                      {AGE_CHOICES.map((a) => (
                        <option key={a} value={a}>
                          {AGE_LABEL[a]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ minWidth: 190 }}>
                    Heritage
                    <select value={it.heritage} onChange={(e) => patch(it.key, { heritage: e.target.value as Item["heritage"] })}>
                      {HERITAGE_CHOICES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={it.auto} disabled={!it.gender || !it.age} onChange={(e) => patch(it.key, { auto: e.target.checked })} />
                  <span className="small">Use as an automatic face for voices with no picture{!it.gender || !it.age ? " (set a gender and an age first)" : ""}</span>
                </label>
                <div className="row wrap" style={{ gap: 12 }}>
                  <label className="field" style={{ minWidth: 150 }}>
                    Zoom
                    <input type="range" min={1} max={3} step={0.05} value={it.zoom} aria-label="Zoom" onChange={(e) => patch(it.key, { zoom: Number(e.target.value) })} />
                  </label>
                  <label className="field" style={{ minWidth: 150 }}>
                    Left to right
                    <input type="range" min={0} max={1} step={0.01} value={it.cx} aria-label="Move left or right" onChange={(e) => patch(it.key, { cx: Number(e.target.value) })} />
                  </label>
                  <label className="field" style={{ minWidth: 150 }}>
                    Up to down
                    <input type="range" min={0} max={1} step={0.01} value={it.cy} aria-label="Move up or down" onChange={(e) => patch(it.key, { cy: Number(e.target.value) })} />
                  </label>
                </div>
                {it.warning && <p className="small" style={{ margin: 0, color: "var(--warn, #ffd28a)" }}>{it.warning}</p>}
                {it.duplicate && (
                  <p className="small" style={{ margin: 0, color: "var(--warn, #ffd28a)" }}>
                    This looks like “{it.duplicate}”, which is already in the library. Add it only if it is a different picture.
                  </p>
                )}
              </div>
              <button className="sm ghost" onClick={() => remove(it.key)} aria-label={`Remove ${it.name}`}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="row end" style={{ marginTop: 16 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !items.length} onClick={() => void add()}>
            {items.length > 1 ? `Add ${items.length} portraits` : "Add portrait"}
          </button>
        </div>
      </div>
    </div>
  );
}
