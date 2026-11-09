// The Character Avatar Library: curated portraits (built from `avatars/library.json` by scripts/build_avatars.py), the
// owner's own avatars, favourites and recently used. A portrait is only a picture. It carries no voice, accent or
// personality, and a character's picture and voice are separate references: changing one never changes the other.

export const COLLECTIONS = ["contemporary_everyday", "ancient_civilizations", "medieval_renaissance", "victorian_edwardian", "western_historical", "fantasy_mythology", "science_fiction_cyberpunk", "horror_supernatural", "stylized_3d_animation", "global_cultural_archetypes"] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const COLLECTION_LABEL: Record<Collection, string> = {
  contemporary_everyday: "Contemporary and everyday",
  ancient_civilizations: "Ancient civilizations",
  medieval_renaissance: "Medieval and Renaissance",
  victorian_edwardian: "Victorian and Edwardian",
  western_historical: "Western and historical",
  fantasy_mythology: "Fantasy and mythology",
  science_fiction_cyberpunk: "Science fiction and cyberpunk",
  horror_supernatural: "Horror and supernatural",
  stylized_3d_animation: "Stylized 3D and animation",
  global_cultural_archetypes: "Global and cultural archetypes",
};

export const AGES = ["child", "teen", "young_adult", "adult", "middle_aged", "older_adult", "elderly", "ageless"] as const;
export type Age = (typeof AGES)[number];
export const AGE_LABEL: Record<Age, string> = { child: "Child", teen: "Teenager", young_adult: "Young adult", adult: "Adult", middle_aged: "Middle-aged", older_adult: "Older adult", elderly: "Elderly", ageless: "Ageless" };

export const STYLES = ["cinematic_realism", "stylized_3d", "painterly", "illustration"] as const;
export const STYLE_LABEL: Record<string, string> = { cinematic_realism: "Cinematic realism", stylized_3d: "Stylized 3D", painterly: "Painterly", illustration: "Illustration" };

export interface AvatarLicense {
  type: string;
  source: string;
  generator?: string;
  /** "confirmed" only when the supplier has recorded the terms. Anything else is shown as unconfirmed. */
  commercial_use: string;
  note?: string;
}

/** A "master" portrait has all four; a "preview" portrait (cut from a contact sheet) has only the 256 card and the thumbnail, because it is never upscaled. */
export interface AvatarAssets {
  master?: string;
  card?: string;
  card_small: string;
  thumbnail: string;
}

export type Tier = "master" | "preview";

export interface AvatarEntry {
  id: string;
  name: string;
  collection: Collection;
  period: string;
  genre: string[];
  style: string;
  age_category: Age;
  archetype: string;
  clothing: string;
  tags: string[];
  /** Only "master" portraits count toward the 100. A "preview" is a smaller picture and is always labelled as one. */
  tier: Tier;
  assets: AvatarAssets;
  license: AvatarLicense;
}

export interface AvatarManifest {
  version: 1;
  target: number;
  count: number;
  collections: string[];
  avatars: AvatarEntry[];
}

export const EXPRESSIONS = ["neutral", "smiling", "angry", "sad", "frightened", "speaking"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** An avatar the owner made or imported. Stored with the voice library, so it is available in every project. */
export interface CustomAvatar {
  id: string;
  name: string;
  createdAt: string;
  /** A 512 pixel square picture and a 128 pixel thumbnail, as data addresses. */
  image: string;
  thumb: string;
  /** Other expressions of the same character. A missing one falls back to the main picture; a face is never swapped for another identity. */
  variants?: Partial<Record<Expression, string>>;
  source: "imported" | "generated";
  prompt?: string;
  tags: string[];
}

export interface AvatarStore {
  custom: CustomAvatar[];
  favorites: string[];
  recent: string[];
}

export const emptyStore = (): AvatarStore => ({ custom: [], favorites: [], recent: [] });
export const RECENT_MAX = 12;
export const isCustomId = (id: string | undefined): boolean => !!id && id.startsWith("custom:");

// ---- Validating what is read ----

const DATA_IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const SAFE_PATH = /^(masters|cards|cards256|thumbs)\/[A-Za-z0-9_.-]+\.(png|webp)$/;

export interface ManifestCheck {
  ok: boolean;
  problems: string[];
  manifest: AvatarManifest | null;
}

/** Checks a manifest read from disk. Anything unsafe or malformed is a problem, and `manifest` holds only the sound entries. */
export function validateManifest(raw: unknown, exists?: (assetPath: string) => boolean): ManifestCheck {
  const problems: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.avatars)) return { ok: false, problems: ["Not a version 1 avatar manifest."], manifest: null };
  const seen = new Set<string>();
  const good: AvatarEntry[] = [];
  for (const item of r.avatars as Record<string, unknown>[]) {
    const id = typeof item?.id === "string" ? item.id : "";
    const bad = (why: string) => problems.push(`${id || "(no id)"}: ${why}`);
    if (!/^[a-z0-9_]{3,80}$/.test(id)) {
      bad("the id is not valid");
      continue;
    }
    if (seen.has(id)) {
      bad("duplicate id");
      continue;
    }
    seen.add(id);
    const a = (item.assets ?? {}) as Record<string, unknown>;
    const tier: Tier = item.tier === "preview" ? "preview" : "master";
    const need = tier === "preview" ? ["card_small", "thumbnail"] : ["master", "card", "card_small", "thumbnail"];
    const paths = need.map((k) => a[k]);
    if (!paths.every((p) => typeof p === "string" && SAFE_PATH.test(p))) {
      bad("an asset path is missing or unsafe");
      continue;
    }
    if (tier === "preview" && (a.master || a.card)) {
      bad("a preview portrait must not claim a master or a 512 card");
      continue;
    }
    if (!(COLLECTIONS as readonly string[]).includes(item.collection as string)) {
      bad("unknown collection");
      continue;
    }
    if (!(AGES as readonly string[]).includes(item.age_category as string)) {
      bad("unknown age category");
      continue;
    }
    const lic = item.license as AvatarLicense | undefined;
    if (!lic || typeof lic.source !== "string" || typeof lic.commercial_use !== "string") {
      bad("rights are not recorded");
      continue;
    }
    if (typeof item.name !== "string" || !item.name || !Array.isArray(item.tags) || !Array.isArray(item.genre) || typeof item.archetype !== "string" || typeof item.period !== "string" || typeof item.style !== "string" || typeof item.clothing !== "string") {
      bad("a required field is missing");
      continue;
    }
    if (exists && !(paths as string[]).every((p) => exists(p))) {
      bad("a listed file does not exist");
      continue;
    }
    good.push({ id, name: item.name, collection: item.collection as Collection, period: item.period, genre: (item.genre as unknown[]).filter((g): g is string => typeof g === "string"), style: item.style, age_category: item.age_category as Age, archetype: item.archetype, clothing: item.clothing, tags: (item.tags as unknown[]).filter((t): t is string => typeof t === "string"), tier, assets: a as unknown as AvatarAssets, license: lic });
  }
  const files = good.flatMap((g) => Object.values(g.assets));
  if (new Set(files).size !== files.length) problems.push("two avatars share an asset file");
  return { ok: problems.length === 0, problems, manifest: { version: 1, target: typeof r.target === "number" ? r.target : 100, count: good.length, collections: [...COLLECTIONS], avatars: good } };
}

/** The saved library, read defensively. Damaged parts are dropped; nothing here can throw. */
export function migrateStore(raw: unknown): AvatarStore {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length <= 100))] : []);
  const custom = (Array.isArray(r.custom) ? r.custom : [])
    .map((c): CustomAvatar | null => {
      const o = (c ?? {}) as Record<string, unknown>;
      if (typeof o.id !== "string" || !o.id.startsWith("custom:") || typeof o.image !== "string" || !DATA_IMG.test(o.image) || typeof o.thumb !== "string" || !DATA_IMG.test(o.thumb)) return null;
      const variants: Partial<Record<Expression, string>> = {};
      for (const e of EXPRESSIONS) {
        const v = (o.variants as Record<string, unknown> | undefined)?.[e];
        if (typeof v === "string" && DATA_IMG.test(v)) variants[e] = v;
      }
      return { id: o.id.slice(0, 80), name: typeof o.name === "string" ? o.name.slice(0, 80) : "Custom avatar", createdAt: typeof o.createdAt === "string" ? o.createdAt : "", image: o.image, thumb: o.thumb, variants: Object.keys(variants).length ? variants : undefined, source: o.source === "generated" ? "generated" : "imported", prompt: typeof o.prompt === "string" ? o.prompt.slice(0, 1500) : undefined, tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string").slice(0, 20) : [] };
    })
    .filter((c): c is CustomAvatar => c !== null);
  return { custom, favorites: ids(r.favorites), recent: ids(r.recent).slice(0, RECENT_MAX) };
}

export const toggleFavorite = (s: AvatarStore, id: string): AvatarStore => ({ ...s, favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] });
export const touchRecent = (s: AvatarStore, id: string): AvatarStore => ({ ...s, recent: [id, ...s.recent.filter((x) => x !== id)].slice(0, RECENT_MAX) });
export const addCustom = (s: AvatarStore, a: CustomAvatar): AvatarStore => ({ ...s, custom: [a, ...s.custom.filter((x) => x.id !== a.id)] });
export const removeCustom = (s: AvatarStore, id: string): AvatarStore => ({ custom: s.custom.filter((c) => c.id !== id), favorites: s.favorites.filter((x) => x !== id), recent: s.recent.filter((x) => x !== id) });

// ---- Finding ----

export interface Query {
  text?: string;
  collection?: string;
  period?: string;
  genre?: string;
  age?: string;
  style?: string;
  /** Limit to these ids (favourites, recently used). */
  only?: Set<string>;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

export function searchText(a: AvatarEntry): string {
  return [a.name, a.collection.replace(/_/g, " "), a.period.replace(/_/g, " "), ...a.genre, a.style.replace(/_/g, " "), a.age_category.replace(/_/g, " "), a.archetype, a.clothing, ...a.tags].join(" ").toLowerCase();
}

export function filterAvatars(list: AvatarEntry[], q: Query): AvatarEntry[] {
  const terms = words(q.text ?? "");
  return list.filter((a) => {
    if (q.only && !q.only.has(a.id)) return false;
    if (q.collection && a.collection !== q.collection) return false;
    if (q.period && a.period !== q.period) return false;
    if (q.genre && !a.genre.includes(q.genre)) return false;
    if (q.age && a.age_category !== q.age) return false;
    if (q.style && a.style !== q.style) return false;
    if (!terms.length) return true;
    const hay = searchText(a);
    return terms.every((t) => hay.includes(t));
  });
}

export const facets = (list: AvatarEntry[]) => ({
  periods: [...new Set(list.map((a) => a.period))].sort(),
  genres: [...new Set(list.flatMap((a) => a.genre))].sort(),
  styles: [...new Set(list.map((a) => a.style))].sort(),
  ages: AGES.filter((g) => list.some((a) => a.age_category === g)),
  collections: COLLECTIONS.filter((c) => list.some((a) => a.collection === c)),
});

// ---- Suggesting from a description ----

/** Words in a description and the portrait attributes they point at. Nationalities and accents are deliberately absent: appearance is never inferred from them. */
const SYNONYMS: Record<string, string[]> = {
  elderly: ["elderly", "older adult", "grey", "white hair", "wise", "elder", "weathered"],
  old: ["elderly", "older adult", "grey", "white hair", "weathered"],
  aged: ["elderly", "older adult"],
  young: ["young adult", "teen"],
  youthful: ["young adult"],
  teenager: ["teen"],
  child: ["child"],
  middle: ["middle aged"],
  stern: ["stern", "authority", "composed"],
  sinister: ["stern", "ominous", "cold", "authority", "dark"],
  menacing: ["stern", "ominous", "authority"],
  villain: ["villain", "ominous", "stern", "cold"],
  kind: ["kind", "gentle", "warm", "caregiver"],
  warm: ["warm", "kind", "gentle"],
  wise: ["wise", "sage", "mentor", "scholar", "elder"],
  mentor: ["mentor", "wise", "sage"],
  scholar: ["scholar", "glasses", "wise"],
  professor: ["scholar", "glasses", "professor"],
  bureaucrat: ["authority", "formal", "professional", "stern"],
  formal: ["formal", "professional", "authority", "blazer", "suit"],
  dressed: ["formal", "blazer", "suit", "elegant"],
  impeccably: ["formal", "elegant", "composed"],
  elegant: ["elegant", "composed", "formal"],
  soldier: ["warrior", "soldier", "rugged"],
  warrior: ["warrior", "rugged", "armour"],
  hero: ["hero", "adventure", "rugged"],
  adventurer: ["adventure", "explorer", "hero", "rugged"],
  explorer: ["explorer", "adventure"],
  rugged: ["rugged", "weathered", "stubble"],
  hacker: ["rebel", "cyberpunk", "futuristic"],
  futuristic: ["futuristic", "cyberpunk", "science fiction"],
  cyberpunk: ["cyberpunk", "futuristic"],
  robot: ["android", "science fiction"],
  executive: ["professional", "authority", "blazer"],
  businessman: ["businessman", "professional", "authority"],
  doctor: ["healer", "professional"],
  nurse: ["healer", "caregiver"],
};

const IGNORED = new Set(["a", "an", "the", "and", "of", "with", "who", "is", "in", "at", "to", "for", "very", "quietly", "british", "english", "scottish", "irish", "american", "french", "german", "nigerian", "indian", "chinese", "japanese", "african", "asian", "european", "accent", "voice", "speaks", "speaking", "man", "woman", "person"]);

export interface Suggestion {
  entry: AvatarEntry;
  score: number;
  /** The attributes of the portrait that matched, so the owner can see why it was offered. */
  why: string[];
}

/**
 * Portraits that suit a character description. It matches the description's words against each portrait's tags,
 * archetype, clothing, age, period and genre. It never infers looks from an accent or nationality. When too few match,
 * it says so by returning fewer, not by padding with unrelated faces.
 */
export function suggestAvatars(description: string, list: AvatarEntry[], n = 6): Suggestion[] {
  const terms = new Set<string>();
  for (const w of words(description)) {
    if (IGNORED.has(w)) continue;
    terms.add(w);
    for (const s of SYNONYMS[w] ?? []) terms.add(s);
  }
  if (!terms.size) return [];
  const out: Suggestion[] = [];
  for (const a of list) {
    const hay = ` ${searchText(a).replace(/_/g, " ")} `;
    const why: string[] = [];
    let score = 0;
    for (const t of terms) {
      if (hay.includes(` ${t} `) || (t.length > 3 && hay.includes(t))) {
        score += a.tags.some((x) => x.toLowerCase().includes(t)) || a.archetype === t ? 3 : 1;
        if (why.length < 4) why.push(t);
      }
    }
    if (score > 0) out.push({ entry: a, score, why });
  }
  return out.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, n);
}

// ---- Showing ----

export interface Face {
  card: string;
  small: string;
  thumb: string;
}

const base = (p: string) => `./avatars/${p}`;

/** The picture addresses for an avatar id, or null when it does not exist (for example a custom avatar that was removed). */
export function faceFor(id: string | undefined, manifest: AvatarManifest | null, store: AvatarStore, expression?: Expression): Face | null {
  if (!id) return null;
  if (isCustomId(id)) {
    const c = store.custom.find((x) => x.id === id);
    if (!c) return null;
    const v = expression ? c.variants?.[expression] : undefined;
    return { card: v ?? c.image, small: v ?? c.image, thumb: v ?? c.thumb };
  }
  const a = manifest?.avatars.find((x) => x.id === id);
  return a ? { card: base(a.assets.card ?? a.assets.card_small), small: base(a.assets.card_small), thumb: base(a.assets.thumbnail) } : null;
}

/** Which expression a line's emotion calls for. Only used when the avatar has that variant; otherwise the main picture is kept. */
export function expressionFor(emotion: string | undefined, speaking = false): Expression {
  const e = (emotion ?? "").toLowerCase();
  if (/angry|annoyed|furious|shouting|villain/.test(e)) return "angry";
  if (/sad|cry|tired|grief|sobs|weeps/.test(e)) return "sad";
  if (/scared|nervous|fright|gasp|afraid/.test(e)) return "frightened";
  if (/happy|excited|laugh|giggle|warm|tender|smil|cheer/.test(e)) return "smiling";
  return speaking ? "speaking" : "neutral";
}

/**
 * Gives a character an avatar (or removes it with undefined). Only `avatarId` changes: the voice, the language and the
 * character profile are untouched, and so is every other character.
 */
export function assignAvatar<T extends { id: string; avatarId?: string }>(characters: T[], characterId: string, avatarId: string | undefined): T[] {
  return characters.map((c) => (c.id === characterId ? { ...c, avatarId } : c));
}

export const BUILTIN_TARGET = 100;

/** Honest progress against the 100-portrait goal: only entries with real files are in the manifest, so only they count. */
export function progress(manifest: AvatarManifest | null): { have: number; previews: number; target: number; missing: number; perCollection: Record<string, number> } {
  const masters = manifest?.avatars.filter((a) => a.tier === "master") ?? [];
  const per: Record<string, number> = {};
  for (const c of COLLECTIONS) per[c] = masters.filter((a) => a.collection === c).length;
  const target = manifest?.target ?? BUILTIN_TARGET;
  return { have: masters.length, previews: (manifest?.avatars.length ?? 0) - masters.length, target, missing: Math.max(0, target - masters.length), perCollection: per };
}

// ---- Automatic faces ----
// A voice or character with no chosen picture shows a built-in portrait instead of a drawn cartoon. The pick is steady (the
// same voice always gets the same face) and is only a default: nothing is saved, and choosing an avatar replaces it.

/** Built-in portraits whose subject is a woman or girl, used only to match a voice's stated gender. */
const FEMALE_FACES = new Set([
  "ancient_queen_001", "ancient_athenian_001", "ancient_oracle_001", "medieval_abbess_001", "renaissance_noblewoman_001", "renaissance_court_lady_001",
  "victorian_governess_001", "edwardian_music_hall_star_001", "edwardian_suffragette_001", "victorian_dowager_001", "western_homesteader_001",
  "historical_field_nurse_001", "fantasy_woodland_ranger_001", "fantasy_sorceress_001", "fantasy_druid_001", "fantasy_shieldmaiden_001", "fantasy_dryad_001",
  "fantasy_elven_scout_001", "cyberpunk_net_courier_001", "scifi_station_director_001", "scifi_wasteland_mechanic_001", "scifi_android_001",
  "horror_medium_001", "horror_veiled_mourner_001", "stylized_inventor_gran_001", "stylized_music_kid_001", "stylized_tea_grandma_001",
  "global_festival_dancer_001", "global_market_matriarch_001", "global_village_elder_001", "global_village_weaver_001",
]);
/** Creatures, robots and portraits whose gender was not judged: never used as an automatic face for a gendered voice. */
const UNSURE_FACES = new Set([
  "stylized_bear_chef_001", "stylized_little_robot_001", "stylized_fox_scout_001", "stylized_baby_dragon_001", "fantasy_horned_beastman_001", "scifi_ambassador_001",
  "stylized_space_cadet_001", "stylized_young_explorer_001", "horror_ghoul_001",
  "scifi_runner_001", "contemporary_editor_001", "contemporary_entrepreneur_001", "contemporary_executive_001", "scifi_guardian_001", "contemporary_analyst_001",
]);
const CREATURE_FACES = new Set(["stylized_bear_chef_001", "stylized_little_robot_001", "stylized_fox_scout_001", "stylized_baby_dragon_001", "fantasy_horned_beastman_001", "scifi_ambassador_001"]);

const seedHash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A steady built-in portrait for a voice with no chosen picture. A male voice never gets a portrait of a woman and the reverse. */
export function autoAvatar(manifest: AvatarManifest | null, seed: string, gender?: string): AvatarEntry | null {
  if (!manifest) return null;
  const g = (gender ?? "").toLowerCase();
  const masters = manifest.avatars.filter((a) => a.tier !== "preview" && !CREATURE_FACES.has(a.id));
  let pool = masters;
  if (g.startsWith("f")) pool = masters.filter((a) => FEMALE_FACES.has(a.id));
  else if (g.startsWith("m")) pool = masters.filter((a) => !FEMALE_FACES.has(a.id) && !UNSURE_FACES.has(a.id));
  if (!pool.length) pool = masters;
  return pool.length ? pool[seedHash(seed) % pool.length]! : null;
}
