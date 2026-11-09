import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ageBand, autoAvatar, genderWord, isPlainFace, LOOKS, readVoice, validateManifest, type AvatarEntry, type AvatarManifest } from "./avatarLibrary";

// These tests run against the real library on disk, so a portrait added with a wrong or missing description is caught here.
const check = validateManifest(JSON.parse(readFileSync(join(__dirname, "..", "public", "avatars", "manifest.json"), "utf8")));
const manifest = check.manifest as AvatarManifest;
const list = manifest.avatars;
const byId = new Map(list.map((a) => [a.id, a]));
const seeds = Array.from({ length: 60 }, (_, i) => "seed-" + i);
const faces = (hint: string, gender = "") => seeds.map((s) => autoAvatar(manifest, s, gender, hint)!);
const childish = (a: AvatarEntry) => a.age_category === "child" || a.age_category === "teen";

describe("the descriptions of the portraits", () => {
  it("every portrait with a description exists, and every plain portrait has a gender and a heritage", () => {
    for (const id of Object.keys(LOOKS)) expect(byId.has(id), `LOOKS names ${id} but the library has no such portrait`).toBe(true);
    for (const a of list.filter(isPlainFace)) {
      expect(LOOKS[a.id], `${a.id} has no description`).toBeDefined();
      expect(["m", "f"], a.id).toContain(LOOKS[a.id]!.g);
    }
  });
  it("every full-resolution portrait has a description, so none is silently skipped", () => {
    for (const a of list.filter((x) => x.tier === "master")) expect(LOOKS[a.id], a.id).toBeDefined();
  });
  it("children and teens in the descriptions are children and teens in the library, and no plain adult is described as a child", () => {
    for (const a of list.filter(isPlainFace)) {
      if (childish(a)) expect(["child", "teen"]).toContain(a.age_category);
    }
  });
});

describe("reading what a voice says about itself", () => {
  const cases: [string, string, Partial<ReturnType<typeof readVoice>>][] = [
    ["Male", "Nigerian EN Casual", { g: "m", h: "black" }],
    ["Female", "Nigerian", { g: "f", h: "black" }],
    ["", "Swahili Congolese", { h: "black" }],
    ["", "A deep, resonant British male voice, late 40s", { g: "m", age: "mid", h: "white" }],
    ["Female", "American bubbly BFF bright cheery storytime", { g: "f", h: "white", age: undefined }],
    ["Male", "A deep, compassionate male voice, mid-40s. En-received-pronunciation", { g: "m", age: "mid", h: "white" }],
    ["", "Indian Hindi", { h: "south_asian" }],
    ["", "Telugu", { h: "south_asian" }],
    ["", "Malayalam", { h: "south_asian" }],
    ["", "Korean", { h: "east_asian" }],
    ["", "Mandarin Chinese", { h: "east_asian" }],
    ["", "Vietnamese", { h: "east_asian" }],
    ["", "Jordanian Arabic", { h: "middle_eastern" }],
    ["", "Mexican Spanish", { h: "latino" }],
    ["", "Brazilian Portuguese", { h: "latino" }],
    ["", "Castilian Spanish", { h: "white" }],
    ["", "German", { h: "white" }],
    ["", "A 9-year-old boy", { g: "m", age: "child" }],
    ["", "a little girl, cheerful", { g: "f", age: "child" }],
    ["", "an 8 year old child", { age: "child" }],
    ["", "a teenage girl", { g: "f", age: "teen" }],
    ["", "a 16-year-old", { age: "teen" }],
    ["", "a young woman in her twenties", { g: "f", age: "young" }],
    ["", "an elderly grandmother", { g: "f", age: "old" }],
    ["", "an old man, 80s", { g: "m", age: "old" }],
    ["", "old-school radio announcer", { age: undefined }],
    ["", "girlfriend voice", { g: "f", age: undefined }],
    ["", "African American woman", { g: "f", h: "black" }],
  ];
  for (const [gender, hint, want] of cases) {
    it(`${gender || "-"} | ${hint}`, () => {
      const got = readVoice(gender, hint);
      for (const [k, v] of Object.entries(want)) expect((got as Record<string, unknown>)[k], k).toEqual(v);
    });
  }
});

describe("automatic faces are faithful to gender", () => {
  const hints = ["", "Nigerian", "British", "American", "Indian Hindi", "Korean", "Jordanian Arabic", "Mexican Spanish", "elderly", "a young woman", "child"];
  for (const g of ["Male", "Female"]) {
    it(`a ${g} voice never gets a portrait of the other gender`, () => {
      for (const h of hints) for (const a of faces(h, g)) expect(LOOKS[a.id]!.g, `${g} / ${h} -> ${a.id}`).toBe(g === "Male" ? "m" : "f");
    });
  }
  it("a voice that says it is male in its description (empty gender field) never gets a woman, and the reverse", () => {
    for (const a of faces("a warm male narrator")) expect(LOOKS[a.id]!.g).toBe("m");
    for (const a of faces("a warm female narrator")) expect(LOOKS[a.id]!.g).toBe("f");
  });
});

describe("automatic faces are faithful to race and heritage", () => {
  const rows: [string, string, string][] = [
    ["Nigerian", "Male", "black"],
    ["Nigerian", "Female", "black"],
    ["African American", "Female", "black"],
    ["Swahili Congolese", "Female", "black"],
    ["Indian Hindi", "Female", "south_asian"],
    ["Indian Hindi", "Male", "south_asian"],
    ["Korean", "Female", "east_asian"],
    ["Mandarin Chinese", "Male", "east_asian"],
    ["Vietnamese", "Female", "east_asian"],
    ["Mexican Spanish", "Male", "latino"],
    ["Mexican Spanish", "Female", "latino"],
    ["British English", "Male", "white"],
    ["British English", "Female", "white"],
    ["American", "Male", "white"],
    ["American", "Female", "white"],
    ["Scottish", "Female", "white"],
    ["German", "Male", "white"],
    ["French", "Female", "white"],
    ["Jordanian Arabic", "Male", "middle_eastern"],
  ];
  for (const [hint, gender, h] of rows) {
    it(`${gender} ${hint} voices get ${h} portraits`, () => {
      for (const a of faces(hint, gender)) expect(LOOKS[a.id]!.h, `${hint}/${gender} -> ${a.id}`).toBe(h);
    });
  }
  it("a Black woman is never used for a white woman's voice, and the reverse", () => {
    for (const a of faces("British", "Female")) expect(LOOKS[a.id]!.h).not.toBe("black");
    for (const a of faces("Nigerian", "Female")) expect(LOOKS[a.id]!.h).not.toBe("white");
  });
});

describe("automatic faces are faithful to age", () => {
  it("a child's voice only ever gets a child or a teen, of the right gender", () => {
    for (const [hint, g] of [["a 9-year-old boy", "m"], ["a little girl", "f"], ["child voice, cheerful", ""], ["young boy", "m"]] as const) {
      for (const a of faces(hint)) {
        expect(childish(a), `${hint} -> ${a.id}`).toBe(true);
        if (g) expect(LOOKS[a.id]!.g).toBe(g);
      }
    }
  });
  it("a Black child gets a Black child", () => {
    for (const a of faces("Nigerian little girl")) expect(LOOKS[a.id]).toMatchObject({ g: "f", h: "black" });
    for (const a of faces("Nigerian little girl")) expect(a.age_category).toBe("child");
    for (const a of faces("Nigerian boy, 9 years old")) expect(LOOKS[a.id]).toMatchObject({ g: "m", h: "black" });
  });
  it("an adult voice is never given a child's portrait, whatever else it says", () => {
    for (const hint of ["", "Nigerian", "British male narrator", "bubbly BFF cheery", "elderly", "mid-40s", "Hindi", "Korean"]) {
      for (const g of ["Male", "Female", ""]) for (const a of faces(hint, g)) expect(childish(a), `${hint}/${g} -> ${a.id}`).toBe(false);
    }
  });
  it("an elderly voice gets an older face where one of that gender and heritage exists", () => {
    for (const a of faces("an elderly Nigerian man")) expect(["older_adult", "elderly"]).toContain(a.age_category);
    for (const a of faces("an elderly British woman")) expect(["older_adult", "elderly"]).toContain(a.age_category);
  });
  it("a young adult voice does not get an elderly face", () => {
    for (const a of faces("a young man in his twenties")) expect(["older_adult", "elderly"]).not.toContain(a.age_category);
  });
});

describe("creatures and story roles", () => {
  const roles: [string, string[]][] = [
    ["a dragon", ["stylized_baby_dragon_001", "fantasy_teal_dragon_001", "fantasy_dragon_knight_001"]],
    ["a friendly robot", ["stylized_little_robot_001", "stylized_white_robot_001", "stylized_orange_robot_001", "scifi_android_001"]],
    ["an alien ambassador", ["scifi_ambassador_001", "scifi_green_alien_001", "scifi_silver_alien_001"]],
    ["a vampire count", ["horror_count_001"]],
    ["the ghost of a woman", ["horror_ghoul_001", "horror_veiled_mourner_001", "horror_teal_spirit_001", "horror_blue_spirit_001", "horror_pale_archivist_001"]],
    ["a goblin", ["horror_goblin_scribe_001", "fantasy_purple_goblin_001"]],
    ["a devil", ["horror_horned_gentleman_001", "horror_horned_lady_001", "horror_horned_young_man_001", "horror_horned_hermit_001", "horror_grey_demon_001"]],
    ["an elf", ["fantasy_elven_scout_001", "fantasy_elf_forest_001", "fantasy_elf_queen_001", "fantasy_woodland_ranger_001"]],
    ["a dwarf", ["fantasy_dwarf_smith_001"]],
    ["a pirate captain", ["historical_privateer_001", "western_pirate_001"]],
    ["the pharaoh", ["ancient_pharaoh_001", "ancient_priest_001", "ancient_queen_001", "ancient_scribe_001"]],
  ];
  for (const [hint, ids] of roles) {
    it(`${hint} gets one of ${ids.length} matching portraits`, () => {
      for (const a of faces(hint)) expect(ids, `${hint} -> ${a.id}`).toContain(a.id);
    });
  }
  it("a male voice described as a devil never gets the horned lady, and a female one never gets a man", () => {
    for (const a of faces("a devil", "Male")) expect(["m", "n"]).toContain(LOOKS[a.id]!.g);
    for (const a of faces("a devil", "Female")) expect(["f", "n"]).toContain(LOOKS[a.id]!.g);
  });
  it("a voice that is merely a person never gets a creature or a costume", () => {
    for (const hint of ["", "a warm narrator", "Nigerian", "casual podcaster", "an elderly teacher"]) {
      for (const a of faces(hint)) expect(isPlainFace(a), `${hint} -> ${a.id}`).toBe(true);
    }
  });
  it("words that only contain a creature's name do not trigger it", () => {
    for (const hint of ["bearing", "a spirited reader", "ghostwriter", "impressive", "the elfin charm of a pixie cut"]) expect(readVoice("", hint).story, hint).toBeUndefined();
  });
});

describe("the voices in the owner's screenshots", () => {
  const ok = (gender: string, hint: string, g: string, h?: string, age?: "adult" | "child") => {
    for (const a of faces(hint, gender)) {
      expect(LOOKS[a.id]!.g, `${hint} -> ${a.id}`).toBe(g);
      if (h) expect(LOOKS[a.id]!.h, `${hint} -> ${a.id}`).toBe(h);
      if (age === "adult") expect(childish(a)).toBe(false);
    }
  };
  it("Alex Oke, a Nigerian male voice, is a Black man", () => ok("Male", "Casual EN Nigerian", "m", "black", "adult"));
  it("Obinna, a Nigerian male voice, is a Black man", () => ok("Male", "Clear, Conversational Nigerian EN Nigerian", "m", "black", "adult"));
  it("Luna, an American female voice, is a white woman", () => ok("Female", "bubbly BFF bright cheery storytime EN American", "f", "white", "adult"));
  it("Fiona, an American female podcaster voice, is a white woman", () => ok("Female", "chill, natural, real, low podcaster voice EN American", "f", "white", "adult"));
  it("Sinister Screwtape, a British male voice in his late 40s, is a white man", () => ok("", "A deep, resonant British male voice, late 40s to early 50s EN", "m", "white", "adult"));
  it("Christ, a compassionate male voice in his mid-40s, is a man and not a pharaoh", () => {
    ok("Male", "A deep, compassionate male voice, mid-40s, En-received-pronunciation", "m", "white", "adult");
    for (const a of faces("A deep, compassionate male voice, mid-40s", "Male")) expect(a.id).not.toMatch(/ancient_|egypt|pharaoh|priest/);
  });
  it("the local voices follow their gender and region", () => {
    ok("female", "Great Britain English Scottish", "f", "white");
    ok("male", "United States English American", "m", "white");
    ok("female", "France French", "f", "white");
    ok("male", "Germany German", "m", "white");
    ok("female", "India Hindi Indian", "f", "south_asian");
    ok("male", "Jordan Arabic Jordanian", "m", "middle_eastern");
    ok("female", "China Chinese Mandarin", "f", "east_asian");
    ok("male", "Mexico Spanish Mexican", "m", "latino");
    ok("female", "Congo Swahili Congolese", "f", "black");
  });
});

describe("steadiness and coverage", () => {
  it("the same voice always gets the same face, and different voices get a spread of faces", () => {
    const a = autoAvatar(manifest, "voice-x", "Male", "Nigerian")!;
    for (let i = 0; i < 5; i++) expect(autoAvatar(manifest, "voice-x", "Male", "Nigerian")!.id).toBe(a.id);
    const ids = new Set(faces("Nigerian", "Male").map((x) => x.id));
    expect(ids.size).toBeGreaterThan(6);
  });
  it("lists which gender, heritage and age combinations have no everyday portrait, so a gap is known and not hidden", () => {
    const gaps: string[] = [];
    for (const g of ["m", "f"] as const)
      for (const h of ["black", "white", "east_asian", "south_asian", "middle_eastern", "latino"] as const)
        for (const grp of ["child", "adult", "elderly"] as const) {
          const hit = list.filter(isPlainFace).some((a) => LOOKS[a.id]?.g === g && LOOKS[a.id]?.h === h && (grp === "child" ? childish(a) : grp === "elderly" ? ["older_adult", "elderly"].includes(a.age_category) : !childish(a)));
          if (!hit) gaps.push(`${g}/${h}/${grp}`);
        }
    // the gaps are part of the documented limits; this fails if a gap appears that was not expected
    expect(gaps).toEqual(EXPECTED_GAPS);
  });
});

/** Combinations with no everyday portrait yet. Shrinks as portraits are added; update it when it does. */
const EXPECTED_GAPS: string[] = [];

describe("what the owner or the voice service states outranks the description", () => {
  const withMeta = (gender: string, hint: string, meta: { age?: "child" | "teen" | "young" | "mid" | "old"; heritage?: "black" | "white" | "east_asian" | "south_asian" | "middle_eastern" | "latino" | "indigenous" }) =>
    seeds.map((s) => autoAvatar(manifest, s, gender, hint, meta)!);
  it("Chloe, a female voice set to a young Black girl, gets a Black girl", () => {
    for (const a of withMeta("Female", "Happy Chloe EN American", { age: "child", heritage: "black" })) {
      expect(LOOKS[a.id], a.id).toMatchObject({ g: "f", h: "black" });
      expect(childish(a), a.id).toBe(true);
    }
  });
  it("a stated heritage and age beat the words in the description", () => {
    for (const a of withMeta("Male", "British narrator", { age: "old", heritage: "south_asian" })) {
      expect(LOOKS[a.id]).toMatchObject({ g: "m", h: "south_asian" });
      expect(["older_adult", "elderly"]).toContain(a.age_category);
    }
  });
  it("a voice that states no age is never given an elderly or a child's face", () => {
    for (const g of ["Male", "Female", ""]) for (const hint of ["", "Nigerian", "American", "Hindi"]) for (const a of faces(hint, g)) expect(["young_adult", "adult", "middle_aged"], `${g}/${hint} -> ${a.id}`).toContain(a.age_category);
  });
  it("every combination of gender, heritage and age has a face of exactly that kind", () => {
    const bands = { child: ["child", "teen"], young: ["teen", "young_adult", "adult"], mid: ["adult", "middle_aged", "older_adult"], old: ["older_adult", "elderly"] } as const;
    for (const g of ["Male", "Female"]) for (const h of ["black", "white", "east_asian", "south_asian", "middle_eastern", "latino"] as const) for (const age of ["child", "mid", "old"] as const) {
      for (const a of withMeta(g, "", { age, heritage: h })) {
        expect(LOOKS[a.id], `${g}/${h}/${age} -> ${a.id}`).toMatchObject({ g: g === "Male" ? "m" : "f", h });
        expect(bands[age], `${g}/${h}/${age} -> ${a.id}`).toContain(a.age_category);
      }
    }
  });
  it("reads ElevenLabs age labels and Piper genders", () => {
    expect(ageBand("young")).toBe("young");
    expect(ageBand("middle_aged")).toBe("mid");
    expect(ageBand("Middle-Aged")).toBe("mid");
    expect(ageBand("old")).toBe("old");
    expect(ageBand("")).toBeUndefined();
    expect(ageBand("odd")).toBeUndefined();
    expect(genderWord("en_GB-alan-low")).toBe("Male");
    expect(genderWord("en_GB-alba-medium")).toBe("Female");
    expect(genderWord("zz-nobody-low")).toBe("");
  });
});

describe("a nationality, a city or an accent is not a costume", () => {
  const plain = ["A hospitable Egyptian shopkeeper in his fifties", "Roman accent, warm", "a Highland Scottish accent", "I cannot bear it when he sings", "A frontier town doctor", "from Cairo, speaking English with an Arabic accent", "a Roman Catholic priest's housekeeper"];
  for (const h of plain) {
    it(`"${h}" gets an ordinary person, not a pharaoh, centurion, warrior or animal`, () => {
      expect(readVoice("", h).story, h).toBeUndefined();
      for (const a of faces(h, "")) expect(isPlainFace(a), `${h} -> ${a.id}`).toBe(true);
    });
  }
  it("the real roles still work", () => {
    expect(readVoice("", "the Pharaoh Ramses").story).toBeDefined();
    expect(readVoice("", "a Roman centurion").story).toBeDefined();
    expect(readVoice("", "a Highland warrior").story).toBeDefined();
    expect(readVoice("", "a talking bear").story).toBeDefined();
    expect(readVoice("", "an ancient Egyptian priest").story).toBeDefined();
  });
});
