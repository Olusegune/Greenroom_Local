"""Builds the Character Avatar Library from source portraits.

    python scripts/build_avatars.py --source "C:\\path\\to\\source pngs"      build derivatives and the runtime manifest
    python scripts/build_avatars.py --check                                   only validate what is already built

Inputs
  avatars/library.json       the curated entries (metadata and the source file name of each portrait)
  --source <folder>          the original portraits, named as in each entry's "source"

Outputs (nothing is ever upscaled; a source under 1024 px is refused)
  avatars/masters/<id>.png                       1024 x 1024 PNG master, kept out of the app bundle
  app/public/avatars/cards/<id>.webp             512 x 512 WebP
  app/public/avatars/cards256/<id>.webp          256 x 256 WebP
  app/public/avatars/thumbs/<id>.webp            128 x 128 WebP
  app/public/avatars/manifest.json               the versioned runtime manifest (only entries whose files exist)

Validation (exit code 1 on any problem)
  unique ids, every listed file exists, sizes are exact, no two portraits are the same picture (exact hash and
  a perceptual difference hash), required metadata present, rights recorded. It also prints how many of the 100
  target portraits exist, and never counts an entry without real files.
"""
import argparse
import hashlib
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "avatars", "library.json")
PLAN = os.path.join(ROOT, "avatars", "plan.json")
MASTERS = os.path.join(ROOT, "avatars", "masters")
PUB = os.path.join(ROOT, "app", "public", "avatars")
TARGET = 100
SIZES = {"cards": 512, "cards256": 256, "thumbs": 128}
COLLECTIONS = ["contemporary_everyday", "ancient_civilizations", "medieval_renaissance", "victorian_edwardian", "western_historical", "fantasy_mythology", "science_fiction_cyberpunk", "horror_supernatural", "stylized_3d_animation", "global_cultural_archetypes"]
AGES = ["child", "teen", "young_adult", "adult", "middle_aged", "older_adult", "elderly", "ageless"]
REQUIRED = ["id", "name", "collection", "period", "genre", "style", "age_category", "archetype", "clothing", "tags", "license"]


def dhash(im, n=16):
    g = im.convert("L").resize((n + 1, n))
    px = list(g.getdata())
    bits = []
    for y in range(n):
        for x in range(n):
            bits.append(px[y * (n + 1) + x] > px[y * (n + 1) + x + 1])
    return int("".join("1" if b else "0" for b in bits), 2)


def hamming(a, b):
    return bin(a ^ b).count("1")


def load_library():
    with open(LIB, encoding="utf-8") as f:
        return json.load(f)


def build(source):
    lib = load_library()
    for d in [MASTERS] + [os.path.join(PUB, k) for k in SIZES]:
        os.makedirs(d, exist_ok=True)
    built = 0
    for e in lib["avatars"]:
        src = os.path.join(source, e["source"])
        if not os.path.isfile(src):
            print(f"  skip  {e['id']}: source file not found ({e['source']})")
            continue
        im = Image.open(src).convert("RGB")
        if min(im.size) < 1024:
            print(f"  REFUSED {e['id']}: source is {im.size}; masters are never upscaled")
            continue
        if im.size[0] != im.size[1]:
            side = min(im.size)
            l, t = (im.size[0] - side) // 2, (im.size[1] - side) // 2
            im = im.crop((l, t, l + side, t + side))
        master = im.resize((1024, 1024), Image.LANCZOS)
        master.save(os.path.join(MASTERS, e["id"] + ".png"), optimize=True)
        for k, px in SIZES.items():
            master.resize((px, px), Image.LANCZOS).save(os.path.join(PUB, k, e["id"] + ".webp"), "WEBP", quality=82 if px >= 256 else 78, method=6)
        built += 1
        print(f"  built {e['id']}")
    print(f"built {built} portrait(s)")


def assets_for(e):
    i = e["id"]
    return {"master": f"masters/{i}.png", "card": f"cards/{i}.webp", "card_small": f"cards256/{i}.webp", "thumbnail": f"thumbs/{i}.webp"}


def present(e):
    a = assets_for(e)
    return os.path.isfile(os.path.join(ROOT, "avatars", a["master"])) and all(os.path.isfile(os.path.join(PUB, a[k].split("/", 1)[0], a[k].split("/", 1)[1])) for k in ("card", "card_small", "thumbnail"))


def write_manifest():
    lib = load_library()
    out = []
    for e in lib["avatars"]:
        if not present(e):
            continue
        item = {k: v for k, v in e.items() if k != "source"}
        item["assets"] = assets_for(e)
        out.append(item)
    manifest = {"version": 1, "target": TARGET, "count": len(out), "collections": COLLECTIONS, "avatars": out}
    with open(os.path.join(PUB, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"wrote manifest with {len(out)} avatar(s)")


def check():
    problems = []
    lib = load_library()
    ids = [e["id"] for e in lib["avatars"]]
    if len(ids) != len(set(ids)):
        problems.append("duplicate ids in library.json")
    plan_ids = [s["id"] for s in json.load(open(PLAN, encoding="utf-8"))["slots"]]
    if set(ids) & set(plan_ids):
        problems.append(f"ids both built and still in the plan: {sorted(set(ids) & set(plan_ids))}")
    hashes, dh = {}, {}
    ok = 0
    for e in lib["avatars"]:
        for k in REQUIRED:
            if k not in e or e[k] in ("", [], None):
                problems.append(f"{e.get('id')}: missing {k}")
        if e.get("collection") not in COLLECTIONS:
            problems.append(f"{e['id']}: unknown collection {e.get('collection')}")
        if e.get("age_category") not in AGES:
            problems.append(f"{e['id']}: unknown age category {e.get('age_category')}")
        if not present(e):
            problems.append(f"{e['id']}: files missing")
            continue
        a = assets_for(e)
        m = Image.open(os.path.join(ROOT, "avatars", a["master"]))
        if m.size != (1024, 1024):
            problems.append(f"{e['id']}: master is {m.size}, not 1024x1024")
        for k, px in (("card", 512), ("card_small", 256), ("thumbnail", 128)):
            im = Image.open(os.path.join(PUB, a[k].split("/", 1)[0], a[k].split("/", 1)[1]))
            if im.size != (px, px) or im.format != "WEBP":
                problems.append(f"{e['id']}: {k} is {im.size} {im.format}")
            im.load()
        h = hashlib.sha256(m.convert("RGB").tobytes()).hexdigest()
        if h in hashes:
            problems.append(f"{e['id']} is the same picture as {hashes[h]}")
        hashes[h] = e["id"]
        d = dhash(m)
        for other, od in dh.items():
            if hamming(d, od) < 24:
                problems.append(f"{e['id']} looks like {other} (difference hash distance {hamming(d, od)})")
        dh[e["id"]] = d
        lic = e["license"]
        if not isinstance(lic, dict) or "commercial_use" not in lic or "source" not in lic:
            problems.append(f"{e['id']}: rights not recorded")
        ok += 1
    unconfirmed = [e["id"] for e in lib["avatars"] if isinstance(e.get("license"), dict) and e["license"].get("commercial_use") != "confirmed"]
    print(f"{ok} of {TARGET} portraits exist and passed file checks; {TARGET - ok} still to make (see avatars/plan.json)")
    if unconfirmed:
        print(f"rights NOT yet confirmed for commercial use on {len(unconfirmed)} portrait(s): the supplier must confirm before release")
    per = {c: sum(1 for e in lib["avatars"] if e["collection"] == c) for c in COLLECTIONS}
    print("per collection:", per)
    for p in problems:
        print("PROBLEM:", p)
    return not problems


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--source")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.source:
        build(a.source)
        write_manifest()
    elif not a.check:
        write_manifest()
    sys.exit(0 if check() else 1)
