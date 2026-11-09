import { AGE_CHOICES, HERITAGE_CHOICES } from "../avatarLibrary";
import type { Character } from "../types";

type Look = NonNullable<Character["look"]>;

/** Who a character is: a few words about them, and a stated gender, age and heritage. Used only to choose a picture and a fitting voice. */
export function CharacterLooks({ name, about, look, onChange }: { name: string; about?: string; look?: Look; onChange: (p: { about?: string; look?: Look }) => void }) {
  const set = (k: keyof Look, v: string) => {
    const next: Look = { ...look, [k]: v || undefined };
    if (!next.gender && !next.age && !next.heritage) onChange({ look: undefined });
    else onChange({ look: next });
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="field">
        About {name}
        <textarea rows={2} maxLength={300} value={about ?? ""} placeholder="For example: a stern grandmother in her sixties" onChange={(e) => onChange({ about: e.target.value || undefined })} />
      </label>
      <div className="row wrap" style={{ gap: 8 }}>
        <label className="field" style={{ minWidth: 120 }}>
          Gender
          <select aria-label={`Gender of ${name}`} value={look?.gender ?? ""} onChange={(e) => set("gender", e.target.value)}>
            <option value="">Not stated</option>
            <option value="f">Woman or girl</option>
            <option value="m">Man or boy</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 150 }}>
          Age
          <select aria-label={`Age of ${name}`} value={look?.age ?? ""} onChange={(e) => set("age", e.target.value)}>
            {AGE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ minWidth: 190 }}>
          Heritage
          <select aria-label={`Heritage of ${name}`} value={look?.heritage ?? ""} onChange={(e) => set("heritage", e.target.value)}>
            {HERITAGE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
