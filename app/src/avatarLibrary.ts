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
// It reads what the voice says about itself (gender, age, and where it is from or what it is described as) and only offers
// portraits that fit; the portraits themselves still carry no voice, accent or personality. The look of each portrait was
// judged by eye by the person who built the library and is kept here, apart from the manifest.

export type Heritage = "black" | "white" | "east_asian" | "south_asian" | "middle_eastern" | "latino" | "indigenous";
type Look = { g: "m" | "f" | "n"; h?: Heritage };
const m = (h?: Heritage): Look => ({ g: "m", h });
const f = (h?: Heritage): Look => ({ g: "f", h });
const NONE: Look = { g: "n" };

/** What each built-in portrait shows: the gender presented and the heritage, for matching a voice to a face. "n" is a creature, robot or alien. */
const LOOKS_DATA: Record<string, Look> = {
  fantasy_adventurer_001: m("east_asian"), contemporary_silver_fox_001: m("white"), scifi_runner_001: f("black"), contemporary_editor_001: f("black"),
  contemporary_entrepreneur_001: f("black"), contemporary_mentor_001: m("white"), contemporary_executive_001: f("east_asian"), scifi_guardian_001: f("south_asian"),
  contemporary_veteran_001: m("latino"), contemporary_analyst_001: f("east_asian"), contemporary_professor_001: m("east_asian"), contemporary_elder_001: m("white"),
  contemporary_traveler_001: m("white"),
  ancient_priest_001: m("black"), ancient_scribe_001: m("black"), ancient_queen_001: f("middle_eastern"), ancient_pharaoh_001: m("middle_eastern"),
  ancient_athenian_001: f("middle_eastern"), ancient_senator_001: m("white"), ancient_centurion_001: m("white"), ancient_king_001: m("middle_eastern"),
  ancient_oracle_001: f("white"), ancient_philosopher_001: m("white"),
  medieval_man_in_mail_001: m("white"), medieval_abbess_001: f("white"), medieval_blacksmith_001: m("white"), medieval_jester_001: m("white"),
  renaissance_noblewoman_001: f("white"), renaissance_scholar_001: m("white"), medieval_man_at_arms_001: m("white"), medieval_squire_001: m("white"),
  renaissance_court_lady_001: f("white"), renaissance_navigator_001: m("white"),
  victorian_patriarch_001: m("white"), victorian_foreman_001: m("white"), victorian_governess_001: f("white"), victorian_steam_engineer_001: m("white"),
  edwardian_music_hall_star_001: f("white"), edwardian_suffragette_001: f("white"), victorian_street_urchin_001: m("white"), victorian_physician_001: m("white"),
  victorian_dowager_001: f("white"), victorian_clockwork_gentleman_001: m("black"),
  western_sheriff_001: m("white"), western_gambler_001: m("white"), western_prospector_001: m("white"), western_rancher_001: m("white"),
  western_frontier_scout_001: m("white"), western_homesteader_001: f("white"), historical_aviator_001: m("white"), historical_field_nurse_001: f("white"),
  historical_revolutionary_001: m("white"), historical_privateer_001: m("black"),
  fantasy_woodland_ranger_001: f("white"), fantasy_dwarf_smith_001: m("white"), fantasy_sorceress_001: f("white"), fantasy_druid_001: f("white"),
  fantasy_shieldmaiden_001: f("white"), fantasy_dryad_001: f("white"), fantasy_dragon_knight_001: m("white"), fantasy_elven_scout_001: f(), fantasy_horned_beastman_001: NONE,
  scifi_android_001: f("white"), cyberpunk_tinkerer_001: m("white"), cyberpunk_net_courier_001: f("white"), scifi_station_director_001: f("white"),
  scifi_wasteland_mechanic_001: f("white"), scifi_ambassador_001: NONE, scifi_refinery_engineer_001: m("white"), cyberpunk_operative_001: m("east_asian"),
  horror_pale_archivist_001: m("white"), horror_count_001: m("white"), horror_monster_hunter_001: m("white"), horror_medium_001: f("white"), horror_exorcist_001: m("white"),
  horror_scarecrow_farmer_001: m("white"), horror_veiled_mourner_001: f("white"), horror_lighthouse_keeper_001: m("white"), horror_occult_professor_001: m("white"), horror_ghoul_001: NONE,
  stylized_bear_chef_001: NONE, stylized_little_robot_001: NONE, stylized_fox_scout_001: NONE, stylized_inventor_gran_001: f("white"), stylized_young_explorer_001: m("white"),
  stylized_baby_dragon_001: NONE, stylized_space_cadet_001: m("east_asian"), stylized_music_kid_001: f("black"), stylized_jazz_grandpa_001: m("black"), stylized_tea_grandma_001: f("east_asian"),
  global_highland_traveller_001: m("indigenous"), global_court_official_001: m("east_asian"), global_andean_elder_001: m("indigenous"), global_storyteller_001: m("indigenous"),
  global_festival_dancer_001: f("latino"), global_tea_master_001: m("east_asian"), global_desert_nomad_001: m("middle_eastern"), global_market_matriarch_001: f("black"),
  global_village_elder_001: f("black"), global_village_weaver_001: f("east_asian"),
  everyday_silver_beard_001: m("black"),
  everyday_glasses_elder_001: m("black"),
  everyday_glasses_beard_001: m("black"),
  everyday_locs_smile_001: m("black"),
  everyday_suit_glasses_001: m("black"),
  everyday_hoops_001: f("black"),
  everyday_braids_001: f("black"),
  everyday_afro_001: f("black"),
  everyday_headwrap_001: f("black"),
  everyday_boy_001: m("black"),
  everyday_boy_grin_001: m("black"),
  everyday_girl_puffs_001: f("black"),
  everyday_asian_man_001: m("east_asian"),
  everyday_asian_hoodie_001: m("east_asian"),
  everyday_asian_woman_001: f("east_asian"),
  everyday_asian_blazer_001: f("east_asian"),
  everyday_asian_long_001: f("east_asian"),
  everyday_asian_teen_001: m("east_asian"),
  everyday_asian_girl_001: f("east_asian"),
  everyday_asian_teen_girl_001: f("east_asian"),
  everyday_asian_gran_001: f("east_asian"),
  everyday_asian_straw_hat_001: m("east_asian"),
  everyday_indian_woman_001: f("south_asian"),
  everyday_indian_woman_2_001: f("south_asian"),
  everyday_sikh_man_001: m("south_asian"),
  everyday_arab_man_001: m("middle_eastern"),
  everyday_latina_girl_001: f("latino"),
  everyday_latina_woman_001: f("latino"),
  everyday_latino_hat_001: m("latino"),
  everyday_white_glasses_woman_001: f("white"),
  everyday_white_curly_woman_001: f("white"),
  everyday_white_woman_001: f("white"),
  everyday_white_grey_man_001: m("white"),
  everyday_white_man_001: m("white"),
  everyday_white_man_jacket_001: m("white"),
  everyday_white_boy_001: m("white"),
  everyday_boy_cap_001: m("white"),
  everyday_indigo_elder_001: m("black"),
  everyday_barrister_001: m("black"),
  everyday_trumpeter_001: m("black"),
  everyday_lab_researcher_001: m("black"),
  everyday_grey_locs_seaman_001: m("black"),
  everyday_retired_professor_001: m("black"),
  everyday_hoodie_man_001: m("black"),
  everyday_blue_agbada_elder_001: m("black"),
  everyday_indigo_storyteller_001: m("black"),
  everyday_blazer_beard_001: m("black"),
  everyday_bold_jacket_001: m("black"),
  everyday_suit_man_001: m("black"),
  everyday_singer_001: m("black"),
  everyday_white_agbada_001: m("black"),
  everyday_teen_glasses_001: m("black"),
  everyday_gele_woman_001: f("black"),
  everyday_doctor_woman_001: f("black"),
  everyday_gele_elder_001: f("black"),
  everyday_glasses_elder_woman_001: f("black"),
  everyday_headwrap_gran_001: f("black"),
  everyday_scarf_woman_001: f("black"),
  everyday_hijab_doctor_001: f("black"),
  everyday_boy_teal_001: m("black"),
  everyday_girl_beads_001: f("black"),
  everyday_girl_hijab_001: f("black"),
  everyday_boy_hoodie_001: m("black"),
  everyday_boy_mustard_001: m("black"),
  everyday_girl_glasses_001: f("east_asian"),
  everyday_laughing_boy_001: m(),
  everyday_girl_journal_001: f("south_asian"),
  everyday_redhead_girl_001: f("white"),
  everyday_silver_bun_woman_001: f("white"),
  everyday_grey_suit_woman_001: f("white"),
  everyday_curly_elder_001: m("white"),
  everyday_freckled_boy_001: m("latino"),
  everyday_taupe_hijab_gran_001: f("middle_eastern"),
  everyday_green_boy_001: m("middle_eastern"),
  everyday_teal_polo_boy_001: m("south_asian"),
  everyday_lavender_girl_001: f("middle_eastern"),
  everyday_grey_beard_grandpa_001: m("south_asian"),
  everyday_brown_jacket_grandpa_001: m("latino"),
  everyday_grey_bun_gran_001: f("latino"),
  everyday_moustache_gentleman_001: m("middle_eastern"),
  everyday_purple_cardigan_gran_001: f("south_asian"),
  everyday_navy_shirt_man_001: m("south_asian"),
  everyday_stubble_man_001: m("middle_eastern"),
  horror_horned_gentleman_001: m("white"),
  horror_goblin_scribe_001: m(),
  horror_horned_lady_001: f("white"),
  horror_horned_young_man_001: m(),
  horror_horned_hermit_001: m(),
  fantasy_ram_horned_brute_001: m(),
  fantasy_mad_alchemist_001: m("white"),
  horror_grey_demon_001: m(),
  western_highland_warrior_001: m("white"),
  victorian_clockwork_tinkerer_001: m("white"),
  victorian_admiral_001: m("white"),
  scifi_green_alien_001: NONE,
  scifi_silver_alien_001: NONE,
  stylized_white_robot_001: NONE,
  stylized_orange_robot_001: NONE,
  horror_teal_spirit_001: f(),
  horror_blue_spirit_001: f(),
  fantasy_elf_forest_001: f("black"),
  fantasy_elf_queen_001: f("black"),
  fantasy_teal_dragon_001: NONE,
  fantasy_purple_goblin_001: m(),
  stylized_astronaut_woman_001: f("south_asian"),
  stylized_turban_grandpa_001: m("south_asian"),
  stylized_glasses_woman_001: f("east_asian"),
  stylized_curly_girl_001: f("black"),
  western_pirate_001: m("white"),
  everyday_khaki_jacket_woman_001: f("middle_eastern"),
  everyday_podcast_locs_001: f("black"),
  everyday_saree_microphone_001: f("south_asian"),
  everyday_embroidered_blouse_001: f("latino"),
  everyday_glasses_blazer_woman_001: f("east_asian"),
  everyday_green_cardigan_woman_001: f("east_asian"),
  everyday_leather_jacket_woman_001: f("black"),
  everyday_hijab_reporter_001: f("black"),
  everyday_green_blazer_woman_001: f("black"),
  everyday_blue_gele_woman_001: f("black"),
};
export const LOOKS: Record<string, Look> = Object.assign(Object.create(null) as Record<string, Look>, LOOKS_DATA);

const seedHash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export type VoiceAge = "child" | "teen" | "young" | "mid" | "old";

export interface VoiceReading {
  g?: "m" | "f";
  age?: VoiceAge;
  h?: Heritage;
  /** Set when the text names a creature, a robot or a story role (a dragon, a pharaoh, a pirate) that has a matching portrait. */
  story?: string[];
}

/**
 * Creatures and story roles a voice or character can be described as, and the portraits that show them. The first row that
 * matches wins. A role that needs a gender the portraits lack (a male wizard) simply finds nothing and the everyday faces are used.
 */
const STORY: [RegExp, string[]][] = [
  [/\b(robots?|androids?|automaton|cyborg|machine voice|synthetic voice)\b/, ["stylized_little_robot_001", "scifi_android_001", "stylized_white_robot_001", "stylized_orange_robot_001"]],
  [/\b(aliens?|extraterrestrial|martian)\b/, ["scifi_ambassador_001", "scifi_green_alien_001", "scifi_silver_alien_001"]],
  [/\bdragons?\b/, ["stylized_baby_dragon_001", "fantasy_dragon_knight_001", "fantasy_teal_dragon_001"]],
  [/\b(goblins?|gnome)\b/, ["horror_goblin_scribe_001", "fantasy_purple_goblin_001"]],
  [/\b(demons?|devils?|imp|fiend|satan|lucifer|horned)\b/, ["horror_horned_gentleman_001", "horror_horned_lady_001", "horror_horned_young_man_001", "horror_horned_hermit_001", "horror_grey_demon_001"]],
  [/\b(monsters?|ogres?|orcs?|trolls?|beastman|brute|gargoyle|minotaur)\b/, ["fantasy_horned_beastman_001", "fantasy_ram_horned_brute_001", "horror_ghoul_001"]],
  [/\b(vampire|nosferatu)\b/, ["horror_count_001"]],
  [/\b(zombie|undead|ghoul|ghost|spectre|specter|wraith|banshee|haunted)\b/, ["horror_ghoul_001", "horror_veiled_mourner_001", "horror_pale_archivist_001", "horror_teal_spirit_001", "horror_blue_spirit_001"]],
  [/\b(elf|elves|elven|elvish|fae|fairy|sprite)\b/, ["fantasy_elven_scout_001", "fantasy_woodland_ranger_001", "fantasy_elf_forest_001", "fantasy_elf_queen_001"]],
  [/\b(dwarf|dwarven)\b/, ["fantasy_dwarf_smith_001"]],
  [/\b(dryad|nymph|tree spirit|forest spirit)\b/, ["fantasy_dryad_001", "fantasy_druid_001"]],
  [/\b(witch|sorceress|sorcerer|wizard|mage|enchantress)\b/, ["fantasy_sorceress_001", "fantasy_druid_001"]],
  [/\b(fox|bear|talking animal)\b/, ["stylized_fox_scout_001", "stylized_bear_chef_001"]],
  [/\b(pharaoh|egyptian|ancient egypt)\b/, ["ancient_pharaoh_001", "ancient_priest_001", "ancient_queen_001", "ancient_scribe_001"]],
  [/\b(roman|centurion|senator|caesar|gladiator)\b/, ["ancient_centurion_001", "ancient_senator_001"]],
  [/\b(viking|norse|valkyrie|shieldmaiden)\b/, ["fantasy_shieldmaiden_001"]],
  [/\b(pirate|privateer|buccaneer|sea captain)\b/, ["historical_privateer_001", "western_pirate_001"]],
  [/\b(cowboy|sheriff|outlaw|gunslinger|prospector|frontier)\b/, ["western_sheriff_001", "western_gambler_001", "western_prospector_001", "western_rancher_001", "western_frontier_scout_001", "western_homesteader_001"]],
  [/\b(knight|man-at-arms|medieval)\b/, ["medieval_man_at_arms_001", "medieval_man_in_mail_001", "medieval_blacksmith_001"]],
  [/\b(jester|court fool)\b/, ["medieval_jester_001"]],
  [/\b(nun|abbess)\b/, ["medieval_abbess_001"]],
  [/\b(priest|exorcist)\b/, ["horror_exorcist_001"]],
  [/\b(hacker|cyberpunk|netrunner)\b/, ["cyberpunk_tinkerer_001", "cyberpunk_net_courier_001", "cyberpunk_operative_001"]],
  [/\b(astronaut|cosmonaut|space cadet)\b/, ["stylized_space_cadet_001", "stylized_astronaut_woman_001"]],
  [/\b(alchemist|inventor|tinkerer|mad scientist)\b/, ["fantasy_mad_alchemist_001", "victorian_clockwork_tinkerer_001", "victorian_steam_engineer_001", "victorian_clockwork_gentleman_001"]],
  [/\b(highland|highlander|clansman)\b/, ["western_highland_warrior_001"]],
  [/\b(admiral|naval officer)\b/, ["victorian_admiral_001"]],
  [/\b(victorian|steampunk)\b/, ["victorian_patriarch_001", "victorian_governess_001", "victorian_steam_engineer_001", "victorian_physician_001", "victorian_dowager_001"]],
];

/**
 * "Great for kids' stories", "a voice for women" and "young adult fiction" say who a voice is FOR, not who it is. Reading them as
 * the voice's own age or gender made narrators look like children. They are removed before the description is read.
 */
export function withoutAudience(text: string): string {
  return text
    .slice(0, 2000)
    .toLowerCase()
    .replace(/\b(for|to|with|about|of|around|among|by|from)\s+(the\s+)?(young\s+|little\s+)?(children|child|kids|kid|toddlers|teens|teenagers|teenager|youth|boys|girls|women|men|ladies|gentlemen|moms|mums|mothers|dads|fathers|seniors|elders|adults|students|learners|audiences|listeners)\b/g, " ")
    .replace(/\b(children|kids|kid|child|teens|women|men)(?:'s|s'|\u2019s)?\s+(stories|story|content|books|shows|audiobooks|programming|games|learning|education|tv|health|products|fiction|literature|channels?|videos?|podcasts?)\b/g, " ")
    .replace(/\b(kid|child|family|teen)[- ]friendly\b/g, " ")
    .replace(/\byoung adult (fiction|novels?|books?|audiences?|content|genre|literature)\b/g, " ");
}

/** Gender, age, heritage and any story role a voice or character states about itself. Anything not stated is left open. */
export function readVoice(gender: string | undefined, hint: string | undefined): VoiceReading {
  const genderText = typeof gender === "string" ? gender.slice(0, 40) : "";
  const t = ` ${genderText} ${withoutAudience(typeof hint === "string" ? hint : "")} `.toLowerCase();
  let g: "m" | "f" | undefined;
  const field = genderText.trim().toLowerCase();
  if (/^(f|female|woman)$/.test(field)) g = "f";
  else if (/^(m|male|man)$/.test(field)) g = "m";
  else if (/\b(female|woman|women|girl|girls|lady|she|her|hers|feminine|mother|mum|mom|grandmother|granny|gran|aunt|auntie|sister|daughter|wife|queen|princess|actress|schoolgirl|heroine|girlfriend)\b/.test(t)) g = "f";
  else if (/\b(male|man|men|boy|boys|guy|he|his|him|masculine|father|dad|grandfather|grandpa|uncle|brother|son|husband|king|prince|baritone|schoolboy|gentleman)\b/.test(t)) g = "m";
  let age: VoiceAge | undefined;
  const num = /\b(\d{1,2})[- ]?(?:years?[- ]old|yo|y\/o|yrs?)\b/.exec(t) ?? /\bage[d ]*(\d{1,2})\b/.exec(t);
  const decade = /\b([1-9])0'?s\b/.exec(t);
  if (num) {
    const n = Number(num[1]);
    age = n < 13 ? "child" : n < 20 ? "teen" : n < 36 ? "young" : n < 60 ? "mid" : "old";
  } else if (decade) {
    // the first decade named: "late 40s to early 60s" is a man in his forties
    const d = Number(decade[1]);
    age = d <= 1 ? "teen" : d <= 3 ? "young" : d <= 5 ? "mid" : "old";
  } else if (/\b(child|children|kid|kids|childlike|child-like|little (boy|girl)|young (boy|girl)|toddler|pre-?teen|tween|infant|baby|youngster|schoolchild)\b/.test(t)) age = "child";
  else if (/\b(teen|teens|teenage|teenager|adolescent|youth|high[- ]school)\b/.test(t)) age = "teen";
  else if (/\b(boy|girl)\b/.test(t) && !/\b(bff|girlfriend|girl next door|good girl|girl power|tomboy)\b/.test(t)) age = "child";
  else if (/\bmiddle[- ]aged\b/.test(t)) age = "mid";
  else if (/\b(elderly|old|older|elder|senior|grandfather|grandmother|grandpa|granny|gran|seventies|eighties|sixties|retired)\b/.test(t) && !/\bold[- ](school|fashioned|time|world|soul|radio)\b|\bolden\b/.test(t)) age = "old";
  else if (/\b(young|youthful|twenties|thirties|millennial|gen[- ]?z)\b/.test(t)) age = "young";
  else if (/\b(middle[- ]aged|mature|forties|fifties)\b/.test(t)) age = "mid";
  let h: Heritage | undefined;
  if (/(nigeri|african|ghana|kenya|south africa|jamaic|caribbean|\bblack\b|haiti|ethiop|swahili|congo|zulu|yoruba|igbo|hausa|uganda|tanzan|senegal|cameroon|twi\b|amharic|pidgin|bahamas|trinidad)/.test(t)) h = "black";
  else if (/(\bindian\b|india\b|pakistan|bengal|hindi|tamil|telugu|malayalam|marathi|gujarati|punjab|urdu|nepal|sri lank|south asian)/.test(t)) h = "south_asian";
  else if (/(chinese|china\b|japan|korean|korea\b|filipino|philippin|tagalog|taglish|vietnam|\bthai\b|thailand|mandarin|cantonese|indonesia|malay\b|east asian|\basian\b)/.test(t)) h = "east_asian";
  else if (/(arab|jordan|egypt|iran|persian|farsi|turk|middle east|lebanon|saudi|moroc|algeria|israel|hebrew|syria|iraq|emirat)/.test(t)) h = "middle_eastern";
  else if (/(castilian|received[- ]pronunciation|\bspain\b|great britain|united kingdom|\buk\b|british|england|english accent|scottish|scotland|irish|ireland|welsh|wales|australia|new zealand|canad|american|united states|\busa\b|northern english|german|french|italian|russian|polish|dutch|swedish|norwegian|danish|finnish|greek|ukrainian|european|caucasian|\bwhite\b)/.test(t)) h = "white";
  else if (/(mexic|spanish|latin|brazil|portugu|colomb|argentin|cuban|hispanic|chile|peru)/.test(t)) h = "latino";
  let story: string[] | undefined;
  for (const [re, ids] of STORY) if (re.test(t)) { story = ids; break; }
  return { g, age, h, story };
}

const AGE_FIT: Record<VoiceAge, Age[]> = {
  child: ["child", "teen"],
  teen: ["teen", "young_adult"],
  young: ["teen", "young_adult", "adult"],
  mid: ["adult", "middle_aged", "older_adult"],
  old: ["older_adult", "elderly"],
};

/**
 * Which portraits may stand in for a voice by default: ordinary people in everyday dress. Costume portraits (a pharaoh, a
 * knight, a vampire, a robot) are only chosen when the voice or character is described as one (see STORY). They stay
 * available in the browser for the owner to choose.
 */
const PLAIN_GLOBAL = new Set(["global_andean_elder_001", "global_tea_master_001", "global_market_matriarch_001", "global_village_elder_001", "global_village_weaver_001"]);
export const isPlainFace = (a: Pick<AvatarEntry, "id" | "tier">): boolean => a.id.startsWith("everyday_") || (a.tier !== "preview" && a.id.startsWith("contemporary_")) || PLAIN_GLOBAL.has(a.id);

/**
 * Genders of the local (Piper) voices, which come with none. From the voice model cards as remembered by the person who
 * built the library, not verified by ear; a voice not listed gets any adult portrait.
 */
const PIPER_DATA: Record<string, "f" | "m"> = {
  alan: "m", alba: "f", jenny_dioco: "f", northern_english_male: "m", cori: "f", lessac: "f", amy: "f", joe: "m", john: "m", kristin: "f", bryce: "m", kusal: "m", ryan: "m",
  claude: "m", ald: "m", kareem: "m", daniela: "f", davefx: "m", carlfm: "m", siwis: "f", tom: "m", thorsten: "m", eva_k: "f", faber: "m", edresson: "m",
  priyamvada: "f", rohan: "m", pratham: "m", kss: "f", huayan: "f", chaowen: "f", xiao_ya: "f", meera: "f", arjun: "m", maya: "f", venkatesh: "m",
};
const PIPER_GENDER: Record<string, "f" | "m"> = Object.assign(Object.create(null) as Record<string, "f" | "m">, PIPER_DATA);
/** "m", "f" or undefined, for a Piper voice key such as "en_GB-alan-low" or a name such as "Alan". */
export function pipergender(keyOrName: string): "m" | "f" | undefined {
  const k = keyOrName.toLowerCase();
  const mid = k.includes("-") ? k.split("-")[1]! : k;
  return PIPER_GENDER[mid.slice(0, 40)] ?? PIPER_GENDER[k.slice(0, 80).replace(/\s+/g, "_")];
}

/** What the owner (or ElevenLabs) says about a voice. Used only to choose the picture, and it outranks the description. */
export interface VoiceMeta {
  age?: VoiceAge;
  heritage?: Heritage;
}

const HERITAGES: Record<Heritage, true> = { black: true, white: true, east_asian: true, south_asian: true, middle_eastern: true, latino: true, indigenous: true };

const UNSTATED_AGE: Age[] = ["young_adult", "adult", "middle_aged"];

/** ElevenLabs age labels (young, middle_aged, old) as a band; anything else is "not stated". */
export function ageBand(label: string | undefined): VoiceAge | undefined {
  const l = (label ?? "").toLowerCase().replace(/[- ]/g, "_");
  return l === "young" ? "young" : l === "middle_aged" || l === "middle" ? "mid" : l === "old" || l === "elderly" || l === "senior" ? "old" : l === "child" ? "child" : l === "teen" || l === "teenager" ? "teen" : undefined;
}

/** "Female", "Male" or "" for a Piper voice key or name, so the library stores a gender for local voices. */
export function genderWord(keyOrName: string): string {
  const g = pipergender(keyOrName);
  return g === "f" ? "Female" : g === "m" ? "Male" : "";
}

export const AGE_CHOICES: { value: VoiceAge | ""; label: string }[] = [
  { value: "", label: "Not stated" },
  { value: "child", label: "Child" },
  { value: "teen", label: "Teenager" },
  { value: "young", label: "Young adult" },
  { value: "mid", label: "Adult / middle-aged" },
  { value: "old", label: "Older / elderly" },
];
export const HERITAGE_CHOICES: { value: Heritage | ""; label: string }[] = [
  { value: "", label: "Not stated" },
  { value: "black", label: "Black / African" },
  { value: "white", label: "White / European" },
  { value: "east_asian", label: "East or Southeast Asian" },
  { value: "south_asian", label: "South Asian" },
  { value: "middle_eastern", label: "Middle Eastern / North African" },
  { value: "latino", label: "Latino / Hispanic" },
  { value: "indigenous", label: "Indigenous" },
];

const isChildish = (a: Pick<AvatarEntry, "age_category">) => a.age_category === "child" || a.age_category === "teen";

/**
 * A steady built-in portrait for a voice or character with no chosen picture. Hard rules, never relaxed: the gender is never
 * crossed when it is known, and a child's portrait goes only to a child and an adult's only to an adult. A stated heritage is
 * matched exactly and only dropped when no portrait of that gender and age exists. A creature or story role (a dragon, a robot,
 * a pharaoh) gets the matching portrait; everything else gets an ordinary person in everyday dress.
 */
export function autoAvatar(manifest: AvatarManifest | null, seed: string, gender?: string, hint?: string, meta?: VoiceMeta, usage?: Map<string, number>): AvatarEntry | null {
  if (!manifest) return null;
  const want = readVoice(gender, hint);
  // what the owner or the voice service states about the voice outranks anything guessed from its description
  if (meta?.age && Object.prototype.hasOwnProperty.call(AGE_FIT, meta.age)) want.age = meta.age;
  if (meta?.heritage && Object.prototype.hasOwnProperty.call(HERITAGES, meta.heritage)) want.h = meta.heritage;
  const known = manifest.avatars.filter((a) => LOOKS[a.id]);
  const pick = (pool: AvatarEntry[]) => pool[seedHash(seed) % pool.length]!;
  if (want.story) {
    const roleFaces = known.filter((a) => want.story!.includes(a.id) && (!want.g || LOOKS[a.id]!.g === "n" || LOOKS[a.id]!.g === want.g));
    if (roleFaces.length) return pick(roleFaces);
  }
  const plain = known.filter((a) => isPlainFace(a) && LOOKS[a.id]!.g !== "n");
  const base = plain.length ? plain : known.filter((a) => LOOKS[a.id]!.g !== "n");
  const byGender = want.g ? base.filter((a) => LOOKS[a.id]!.g === want.g) : base;
  const wantsChild = want.age === "child";
  // childhood is a hard rule: a child voice only ever gets a child or teen portrait, anyone else never does
  const byLife = byGender.filter((a) => (wantsChild ? isChildish(a) : !isChildish(a) || want.age === "teen"));
  const life = byLife.length ? byLife : byGender;
  // a voice that states no age is not given an elderly face: it gets a young adult, adult or middle-aged one
  const ageOk = (a: AvatarEntry) => (want.age ? AGE_FIT[want.age].includes(a.age_category) : UNSTATED_AGE.includes(a.age_category));
  const heritageOk = (a: AvatarEntry) => !want.h || LOOKS[a.id]!.h === want.h;
  const tiers = [life.filter((a) => ageOk(a) && heritageOk(a)), life.filter(heritageOk), life.filter(ageOk), life];
  let pool = tiers.find((t) => t.length) ?? [];
  if (usage && pool.length > 1) {
    // spread: among the fitting faces, prefer the ones given to the fewest voices so far
    const least = Math.min(...pool.map((a) => usage.get(a.id) ?? 0));
    pool = pool.filter((a) => (usage.get(a.id) ?? 0) === least);
  }
  return pool.length ? pick(pool) : null;
}
