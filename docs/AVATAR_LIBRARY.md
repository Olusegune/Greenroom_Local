# Character Avatar Library

**Status (2026-11-08): 12 of the 100 required full-resolution portraits exist, plus 22 preview-resolution portraits that do not count toward the 100. The 100-avatar requirement is NOT complete.** The pipeline, the manifest, the browser and all the integration are built and tested. The other 88 portraits need to be made (see `avatars/plan.json`, which holds a prompt for each) and then run through the same pipeline. Nothing was duplicated, recoloured or upscaled to reach a count.

## What the owner gets

Press any character's face (Cast, Perform, the character rail, the Reaction Library) to open the **Avatar browser**.

![The Avatar browser](img/avatar-library.jpg)

- **Browse** as a grid or a list; **search** by any word (name, tags, clothing, period, archetype); **filter** by collection, historical period, genre, age category and visual style; only choices that exist are offered.
- **Favourites**, **Recently used** and **My avatars** are one press away.
- **Preview** shows a face large with its collection, period, age, clothing, tags and its **rights status**.
- **Use for [character]** assigns it; **Replace with this** swaps one already assigned; **Remove the avatar** returns to the default face.

![Preview and assignment](img/avatar-preview.jpg)

- **Suggest avatars** reads a description (it starts from the character's name and profile) and offers matching portraits with the words that matched. It reads appearance words (elderly, blazer, stern, scholar) and **ignores accents and nationalities**: "British" never changes the suggestions. It offers fewer rather than unrelated faces, and you can always choose any avatar yourself.
- **Import an image** makes one of **My avatars** from a picture on your computer; it never leaves your computer.
- **Create a custom avatar** takes a character description, period, genre, visual style, clothing, expression and background, shows the exact text that will be sent, and after a cost sheet (Kie, your own key) makes a picture. Only that text is sent: no pictures, project text or voice data. You name it and choose whether to save it.
- **Expressions**: a custom avatar can hold neutral, smiling, angry, sad, frightened and speaking pictures of the same character. Perform shows the one matching a line's feeling, and the main picture when there is none. A face is never swapped for a different identity.

![An avatar assigned to a character on Perform: the card, the rail and the unchanged voice](img/avatar-assigned.jpg)

## Avatar and voice are separate

A character holds separate references: its own id, an **avatar id** (`avatarId`), a **voice** (`voiceId`) and its acting profile (the Voice DNA already on the character). Changing the avatar changes nothing else; changing the voice leaves the avatar alone. The same avatar can serve any number of characters and projects. A portrait never carries a voice, accent or personality: the manifest has no such field and a test fails if one is added. Projects saved before avatars existed open unchanged.

## Two tiers

| Tier | What it has | Counts toward the 100 |
|---|---|---|
| **Master** | 1024 x 1024 PNG master, 512 and 256 WebP cards, 128 thumbnail | Yes (12 so far) |
| **Preview** | Only a 256 WebP card and a 128 thumbnail, cut from a contact sheet. No master and no 512 card, because the sheet tiles are about 330 px and are never upscaled | No (22 so far) |

Previews are labelled "Preview" in the browser and the preview panel says so. The manifest and a test refuse a preview that claims a master or a 512 card.

### What the "NEW IMAGES FOR GREEN ROOM" sheets turned out to be

Five distinct contact sheets (and `IMAGES.png`, an exact copy of `Mosaic-1`). Two sheets hold 15 realistic portraits at about 330 px each; from them 22 portraits were cut after removing one tile with a watermark logo and the near-duplicates of the same subject across the two sheets (the boy in the red hoodie, the alien, the orc, the vampire, the straw-hat elder, the bride, the cowboy: one of each was kept). The three 90-tile sheets (two realistic, one cartoon) have tiles of about 150 x 110 px, smaller than a 128 px thumbnail, so none was used. The cartoon sheet and one mosaic also contain recognisable look-alikes (a Joker, a Wednesday Addams, a Gandalf, an Einstein, a queen who resembles Queen Elizabeth), which must never be used even if they were large enough. Several of the 22 are framed tightly (a hat or hair touches the top edge): the previews were cut, not re-framed.

## Where things live

| Thing | Location |
|---|---|
| Curated entries (metadata, and each portrait's source file name) | `avatars/library.json` |
| 1024 x 1024 PNG masters, kept out of the app bundle | `avatars/masters/` |
| What still has to be made, with a prompt for each | `avatars/plan.json` |
| 512 px WebP cards, 256 px cards, 128 px thumbnails and the runtime manifest, bundled in the app | `app/public/avatars/` |
| The owner's avatars, favourites and recent list | `avatars.json` in Documents/Greenroom Local |

Bundled size for the 12 portraits is about 650 KB; the masters (19 MB) are not loaded by the app.

## Adding portraits (the pipeline)

1. Make a portrait from its prompt in `avatars/plan.json` (or your own), square, head and shoulders, face centred with a safe margin, clean background, no text or watermark, at 1024 x 1024 or larger.
2. Add its entry to `avatars/library.json` (id, name, collection, period, genre, style, age category, archetype, clothing, tags, the `source` file name and its `license`), and remove its slot from `plan.json`.
3. Run `python scripts/build_avatars.py --source "<folder with the pictures>"`. It writes the master and the three derivatives, rewrites the manifest, and validates everything. A source under 1024 px is **refused**: masters are never upscaled.
4. `npx vitest run` checks the library on disk (below). Updates are incremental: only new entries are added, and existing ones are rebuilt from their sources.

`python scripts/build_avatars.py --check` validates what is already built: unique ids, every listed file present, exact sizes and formats, no two portraits the same picture (exact hash and a perceptual difference hash), required metadata, rights recorded. It prints how many of the 100 exist and which collections are short.

## The ten collections and what exists

| Collection | Made | Planned slots still missing |
|---|---|---|
| Contemporary and everyday | 9 (+7 preview) | 1 |
| Ancient civilizations | 0 | 10 |
| Medieval and Renaissance | 0 (+1 preview) | 10 |
| Victorian and Edwardian | 0 | 10 |
| Western and historical | 0 (+1 preview) | 10 |
| Fantasy and mythology | 1 (+3 preview) | 9 |
| Science fiction and cyberpunk | 2 (+4 preview) | 8 |
| Horror and supernatural | 0 (+1 preview) | 10 |
| Stylized 3D and animation | 0 | 10 |
| Global and cultural archetypes | 0 (+5 preview) | 10 |

The 12 portraits are all one visual style (cinematic realism). The planned slots add variety across periods, cultures, ages and a stylized 3D collection. I could not make them: the image tool I looked for (the local SimpliGen app) was not running, and Greenroom's own image route (Kie) has only been tested against a fake server and costs money, which automated work must not spend.

## Rights

All portraits were **supplied by the owner** (the folders "Green Local avatars" and "NEW IMAGES FOR GREEN ROOM"), who stated on 2026-11-08 that the images belong to them. Each entry records that statement and `commercial_use: "confirmed"` on the owner's word. **The tool that made the images and its terms were not recorded**, so keep your own record of them: ownership of generated images can depend on the generator's terms, and a distributor may ask. None of the portraits used is a recognisable real person or franchise character as far as can be seen, but nobody has verified that, and the orc and vampire are generic fantasy types. For the remaining 88, every entry must record where its art came from.

## QA (what was checked, 2026-11-08)

| Check | Result |
|---|---|
| Every manifest entry references real files; no broken paths | Passed for all 34 (automatic test reads the files) |
| No duplicate ids or asset files; no two portraits the same picture | Passed (exact hashes in the test; perceptual hash in the build script) |
| Masters 1024 x 1024 PNG; cards 512, 256 and thumbnails 128 WebP, exact sizes (previews: 256 and 128 only) | Passed |
| Bundled files small (thumbnails under 15 KB, cards under 120 KB) | Passed |
| Search, filters, favourites, recent, suggestions | Passed (unit tests); suggestions ignore accents and nationalities |
| Assignment: avatar changes nothing else; voice changes nothing about the avatar | Passed (tests, and in the demo the voice stayed "Alex" while the face changed) |
| Persistence of avatar, favourites, recent and custom avatars | Rust test (saves and reloads, refuses bad data) and JavaScript tests; **not tested across a real restart of the installed app** |
| Existing projects open unchanged | Passed (test) |
| No unwanted network requests | Passed (test: the only fetch is the relative manifest; the one paid path asks first). **Not measured with a network monitor** |
| Smooth scrolling and memory with thousands of avatars | **Not measured.** Only visible rows are drawn and pictures load lazily (tested in code), but no thousand-image library exists to try it on |
| Shown in Casting Studio, Perform, the character rail, the Reaction Library, the script screen's cast list | Done |
| Shown in Acting Director, Scene Studio, the dialogue timeline, the Voice Library | **Not done.** The Acting Director is the Director panel inside Perform (the face is on its card); Greenroom has no separate Scene Studio or dialogue-timeline faces; the Voice Library still shows voice pictures and drawn faces |
| 100 distinct full-resolution portraits | **Not met: 12 exist** (plus 22 previews that do not count) |
