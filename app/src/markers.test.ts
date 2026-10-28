import { describe, expect, it } from "vitest";
import { planTimeline } from "./audio";
import { audacityLabels, buildMarkers, cueSheetCsv, edl, fileUrl, otioTimeline, timecode } from "./markers";
import { DEFAULT_DIRECTION, newProject, type Line, type Project } from "./types";

const take = (id: string, seconds: number) => ({ id, at: "", model: "eleven_v4" as const, ext: "mp3" as const, voiceId: "voiceX", sent: "[sighs] hi, \"you\"", seconds });

function project(): Project {
  const p = newProject("p1", "Late Delivery", "2026-10-26");
  p.scenes = ["Scene 1", "Scene 2"];
  p.characters = [{ id: "c1", name: "ADA", language: "English" }, { id: "c2", name: "TUNDE", language: "English" }];
  const mk = (id: string, ch: string, scene: number, secs: number, extra: Partial<Line> = {}): Line => ({ id, characterId: ch, scene, text: "Hello, world", direction: { ...DEFAULT_DIRECTION, pauseAfter: 0.5, gain: -3, emotion: "sad", sounds: ["sighs"] }, takes: [take("t" + id, secs)], events: [], ...extra });
  p.lines = [
    mk("a", "c1", 0, 2, { events: [{ id: "e1", prompt: "door", placement: "after", seconds: 1, take: { id: "s1", ext: "mp3", seconds: 1 } }] }),
    mk("b", "c2", 0, 1),
    { ...mk("c", "c1", 1, 1), takes: [] },
  ];
  p.bed = { prompt: "rain", volume: 0.3, take: { id: "bed1", ext: "mp3", seconds: 4 } };
  return p;
}

describe("timecode", () => {
  it("counts hours, minutes, seconds and frames", () => {
    expect(timecode(0, 24)).toBe("00:00:00:00");
    expect(timecode(3661.5, 24)).toBe("01:01:01:12");
    expect(timecode(59.999, 25)).toBe("00:00:59:24");
    expect(timecode(-5, 30)).toBe("00:00:00:00");
    expect(timecode(1, 24)).toBe("00:00:01:00");
  });
});

describe("markers and label track", () => {
  it("number lines the way file names do, and skip lines with no take", () => {
    const p = project();
    const m = buildMarkers(p, planTimeline(p));
    expect(m.map((x) => [x.name, x.sec, x.endSec])).toEqual([["01 ADA", 0, 2], ["02 TUNDE", 3.5, 4.5]]);
  });
  it("writes an Audacity label track", () => {
    const p = project();
    expect(audacityLabels(buildMarkers(p, planTimeline(p)))).toBe("0.000000\t2.000000\t01 ADA\n3.500000\t4.500000\t02 TUNDE\n");
  });
});

describe("cue sheet", () => {
  it("lists each spoken line with timing and provenance, and escapes commas and quotes", () => {
    const p = project();
    const csv = cueSheetCsv(p, planTimeline(p), 24);
    expect(csv.startsWith("\uFEFFLine,Scene,Character")).toBe(true);
    const rows = csv.trim().split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('1,Scene 1,ADA,00:00:00:00,00:00:02:00,0.000,2.000,2.000,"Hello, world",sad; sighs,-3.0,voiceX,eleven_v4,ta,"[sighs] hi, ""you"""');
    expect(rows[2]).toContain("2,Scene 1,TUNDE,00:00:03:12");
  });
});

describe("cue sheet provenance columns", () => {
  it("adds engine, audio quality, fingerprint and voice rights at the end of each row", () => {
    const p = project();
    p.characters[0]!.voiceId = "voiceX";
    p.lines[0]!.takes[0]!.provenance = { engine: "elevenlabs", voiceName: "Ada", quality: "wav_48000", speed: 1, chars: 12, sha256: "f".repeat(64), appVersion: "0.6.0", emotion: "", sounds: [], note: "", pronunciations: 0 };
    const lib = [{ id: "voiceX", name: "Ada", provider: "elevenlabs" as const, source: "cloned" as const, language: "", accent: "", gender: "", notes: "", createdAt: "" }];
    const csv = cueSheetCsv(p, planTimeline(p), 24, lib);
    const rows = csv.trim().split("\r\n");
    expect(rows[0]!.endsWith("Engine,Audio quality,SHA-256,Voice rights")).toBe(true);
    expect(rows[1]!.endsWith(`ElevenLabs,wav_48000,${"f".repeat(64)},missing`)).toBe(true);
    // A take made before provenance was recorded, with no voice chosen, leaves those cells empty.
    expect(rows[2]!.endsWith(",,,")).toBe(true);
  });
});

describe("OpenTimelineIO", () => {
  const files = { ta: "C:\\Users\\me\\Documents\\Greenroom\\a b.wav", tb: "C:\\x\\b.mp3", s1: "C:\\x\\door.mp3", bed1: "C:\\x\\rain.mp3" };
  it("turns Windows paths into file URLs", () => {
    expect(fileUrl("C:\\Users\\me\\My Folder\\a.wav")).toBe("file:///C:/Users/me/My%20Folder/a.wav");
    expect(fileUrl("/home/me/a.wav")).toBe("file:///home/me/a.wav");
  });
  it("builds one audio track per character, sound clips and atmosphere with exact positions", () => {
    const p = project();
    const doc = JSON.parse(otioTimeline(p, planTimeline(p), 24, files));
    expect(doc.OTIO_SCHEMA).toBe("Timeline.1");
    const tracks = doc.tracks.children;
    expect(tracks.map((t: { name: string }) => t.name)).toEqual(["ADA", "TUNDE", "Sound clips", "Atmosphere"]);
    expect(tracks.every((t: { kind: string }) => t.kind === "Audio")).toBe(true);
    const tunde = tracks[1].children;
    expect(tunde[0].OTIO_SCHEMA).toBe("Gap.1");
    expect(tunde[0].source_range.duration.value).toBe(3.5 * 24);
    expect(tunde[1].source_range.duration.value).toBe(24);
    expect(tunde[1].media_reference.target_url).toBe("file:///C:/x/b.mp3");
    expect(tunde[1].metadata.greenroom.gain_db).toBe(-3);
    const ada = tracks[0].children;
    expect(ada[0].media_reference.target_url).toBe("file:///C:/Users/me/Documents/Greenroom/a%20b.wav");
    expect(ada[0].name).toBe("01 ADA");
  });
  it("covers the whole scene with repeated atmosphere clips and trims the last", () => {
    const p = project();
    const plan = planTimeline(p);
    const doc = JSON.parse(otioTimeline(p, plan, 24, files));
    const bed = doc.tracks.children[3].children;
    const total = bed.reduce((s: number, c: { source_range: { duration: { value: number } } }) => s + c.source_range.duration.value, 0);
    expect(total).toBeCloseTo(plan.total * 24, 3);
    expect(bed.length).toBe(Math.ceil(plan.total / 4));
  });
  it("marks a clip as missing media when its file was not exported", () => {
    const p = project();
    const doc = JSON.parse(otioTimeline(p, planTimeline(p), 24, {}));
    expect(doc.tracks.children[0].children[0].media_reference.OTIO_SCHEMA).toBe("MissingReference.1");
  });
});

describe("OpenTimelineIO with a picture", () => {
  const files = { ta: "C:/x/a.wav", tb: "C:/x/b.mp3", s1: "C:/x/door.mp3", bed1: "C:/x/rain.mp3" };
  const pic = { path: "D:/Film/Rough Cut.mov", name: "Rough Cut.mov", fpsNum: 24000, fpsDen: 1001, fpsKnown: true, duration: 20.02, width: 1920, height: 1080, startFrame: 86400 };

  it("uses the picture's exact frame rate and start timecode and carries a video track", () => {
    const p = project();
    const doc = JSON.parse(otioTimeline(p, planTimeline(p, undefined, { minTotal: pic.duration }), 24, files, pic));
    expect(doc.global_start_time.value).toBe(86400);
    expect(doc.global_start_time.rate).toBeCloseTo(23.976023976, 6);
    expect(doc.metadata.greenroom.start_timecode).toBe("01:00:00:00");
    const names = doc.tracks.children.map((t: { name: string; kind: string }) => `${t.kind}:${t.name}`);
    expect(names[0]).toBe("Video:Picture");
    expect(names.slice(1)).toEqual(["Audio:ADA", "Audio:TUNDE", "Audio:Sound clips", "Audio:Atmosphere"]);
    const v = doc.tracks.children[0].children[0];
    expect(v.media_reference.target_url).toBe("file:///D:/Film/Rough%20Cut.mov");
    expect(v.source_range.duration.value).toBeCloseTo(20.02 * (24000 / 1001), 4);
  });

  it("puts overlapping dialogue on its own lane so no track holds two clips at once", () => {
    const p = project();
    p.lines[1]!.characterId = "c1"; // TUNDE's line now belongs to ADA
    p.lines[0]!.cue = 0;
    p.lines[1]!.cue = 1; // starts while ADA's first line (2 s) is still speaking
    const plan = planTimeline(p);
    const doc = JSON.parse(otioTimeline(p, plan, 24, files));
    const names = doc.tracks.children.map((t: { name: string }) => t.name);
    expect(names.slice(0, 2)).toEqual(["ADA", "ADA 2"]);
    const lane2 = doc.tracks.children[1].children;
    expect(lane2[0].OTIO_SCHEMA).toBe("Gap.1");
    expect(lane2[0].source_range.duration.value).toBe(1 * 24);
    for (const t of doc.tracks.children) {
      let cursor = 0;
      for (const c of t.children) cursor += c.source_range.duration.value;
      expect(cursor).toBeLessThanOrEqual(plan.total * 24 + 1e-6);
    }
  });

  it("writes the cue sheet in the picture's timecode", () => {
    const p = project();
    p.lines[0]!.cue = 3;
    const csv = cueSheetCsv(p, planTimeline(p), 24, [], pic);
    expect(csv).toContain("01:00:03:00");
  });
});

describe("markers past the end of the mix", () => {
  it("leave out a line that starts after the mix ends", () => {
    const p = project();
    p.lines[1]!.cue = 50;
    const m = buildMarkers(p, planTimeline(p, undefined, { exactTotal: 10 }));
    expect(m.map((x) => x.name)).toEqual(["01 ADA"]);
  });
});

describe("OpenTimelineIO with music", () => {
  it("gives music its own track, starting inside the file where the trim begins", () => {
    const p = project();
    p.music = [{ id: "m1", name: "Theme", take: { id: "mus1", ext: "mp3", seconds: 30 }, start: 2, gainDb: -6, fadeIn: 0.5, fadeOut: 2, trimIn: 10, length: 8, duck: true, source: "x" }];
    const doc = JSON.parse(otioTimeline(p, planTimeline(p), 24, { mus1: "C:/x/Theme.mp3" }));
    const t = doc.tracks.children.find((x: { name: string }) => x.name === "Music");
    expect(t).toBeTruthy();
    expect(t.children[0].OTIO_SCHEMA).toBe("Gap.1");
    expect(t.children[0].source_range.duration.value).toBe(2 * 24);
    const c = t.children[1];
    expect(c.name).toBe("Theme");
    expect(c.source_range.start_time.value).toBe(10 * 24);
    expect(c.source_range.duration.value).toBe(8 * 24);
    expect(c.media_reference.available_range.duration.value).toBe(30 * 24);
    expect(c.metadata.greenroom).toMatchObject({ kind: "music", gain_db: -6, ducks_under_dialogue: true });
  });
});

describe("CMX 3600 cut list", () => {
  const files = { ta: "C:/x/a.wav", tb: "C:/x/b.mp3", s1: "C:/x/door.mp3", bed1: "C:/x/rain.mp3" };
  const pic = { path: "D:/Film/Rough Cut.mov", name: "Rough Cut.mov", fpsNum: 24000, fpsDen: 1001, fpsKnown: true, duration: 12, width: 1920, height: 1080, startFrame: 86400 };
  const events = (t: string) => t.split("\r\n").filter((l) => /^\d{3} /.test(l));

  it("starts with a title and the frame-count mode, then numbers events in time order", () => {
    const p = project();
    const text = edl(p, planTimeline(p), 24, files);
    const lines = text.split("\r\n");
    expect(lines.slice(0, 2)).toEqual(["TITLE: Late Delivery", "FCM: NON-DROP FRAME"]);
    const ev = events(text);
    expect(ev.length).toBeGreaterThan(3);
    ev.forEach((l, i) => expect(l.startsWith(String(i + 1).padStart(3, "0") + "  AX       AA        C        ")).toBe(true));
    const recIns = ev.map((l) => l.trim().split(/\s+/)[6]!);
    expect([...recIns].sort()).toEqual(recIns);
  });

  it("gives every event four timecodes, with source times counted from the start of the file", () => {
    const p = project();
    const ev = events(edl(p, planTimeline(p), 24, files));
    for (const l of ev) {
      const tcs = l.trim().split(/\s+/).slice(-4);
      expect(tcs).toHaveLength(4);
      for (const t of tcs) expect(t).toMatch(/^\d\d:\d\d:\d\d:\d\d$/);
    }
    expect(ev[0]!.trim().split(/\s+/).slice(-4)).toEqual(["00:00:00:00", "00:00:02:00", "00:00:00:00", "00:00:02:00"]);
  });

  it("names the original file and the stem for each event", () => {
    const p = project();
    const text = edl(p, planTimeline(p), 24, files);
    expect(text).toContain("* FROM CLIP NAME: a.wav");
    expect(text).toContain("* COMMENT: ADA - 01 ADA (gain -3.0 dB)");
    expect(text).toContain("* FROM CLIP NAME: door.mp3");
  });

  it("puts record times on the picture's start timecode and keeps overlapping clips as separate events", () => {
    const p = project();
    p.lines[1]!.characterId = "c1";
    p.lines[0]!.cue = 0;
    p.lines[1]!.cue = 1;
    const ev = events(edl(p, planTimeline(p, undefined, { minTotal: pic.duration }), 24, files, pic));
    const at = (n: number) => ev[n]!.trim().split(/\s+/).slice(-2);
    expect(at(0)[0]).toBe("01:00:00:00");
    expect(ev.filter((l) => l.includes("01:00:01:")).length).toBeGreaterThan(0);
    expect(ev.length).toBe(new Set(ev.map((l) => l.slice(0, 3))).size);
  });

  it("loops the atmosphere to its length, skips clips shorter than a frame, and keeps music trims as the source start", () => {
    const p = project();
    p.music = [{ id: "m", name: "Theme", take: { id: "mt", ext: "wav", seconds: 20 }, start: 0, gainDb: -6, fadeIn: 0, fadeOut: 1, trimIn: 5, length: 3, duck: true, source: "" }];
    const text = edl(p, planTimeline(p), 24, { ...files, mt: "C:/x/theme.wav" });
    const atmos = text.split("\r\n").filter((l) => l.includes("Atmosphere") && l.startsWith("* COMMENT"));
    expect(atmos.length).toBeGreaterThan(1);
    const music = events(text).find((_, i, a) => text.includes("Theme") && a[i] && true);
    expect(text).toContain("* COMMENT: Music - Theme (gain -6.0 dB, dips under dialogue)");
    expect(events(text).some((l) => l.trim().split(/\s+/).slice(-4).slice(0, 2).join(" ") === "00:00:05:00 00:00:08:00")).toBe(true);
    expect(music).toBeDefined();
  });
});
