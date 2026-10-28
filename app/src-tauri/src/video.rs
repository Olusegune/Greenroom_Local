//! Reading a video's frame rate, size and length so audio can be placed against picture.
//!
//! MP4, MOV and M4V files keep these in the `moov` box: the frame rate comes from the video track's time scale and its
//! `stts` (sample timing) table, so a 23.976 fps file reads as exactly 24000/1001. Other containers (WebM, MKV, AVI,
//! MPEG) are accepted for playback but their frame rate is not read: the owner chooses it. Nothing here decodes video.

use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub const EXTENSIONS: [&str; 8] = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mpg", "mpeg"];
const MAX_MOOV: u64 = 64 << 20;

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub container: String,
    /// True when the frame rate and length were read from the file.
    pub known: bool,
    pub fps_num: u32,
    pub fps_den: u32,
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
}

pub fn ext_of(path: &Path) -> Option<String> {
    path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).filter(|e| EXTENSIONS.contains(&e.as_str()))
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 { a } else { gcd(b, a % b) }
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}
fn be64(b: &[u8], at: usize) -> Option<u64> {
    b.get(at..at + 8).map(|s| u64::from_be_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]]))
}

/// The boxes directly inside a buffer: (type, payload).
fn boxes(buf: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at + 8 <= buf.len() {
        let size = be32(buf, at).unwrap_or(0) as u64;
        let ty = [buf[at + 4], buf[at + 5], buf[at + 6], buf[at + 7]];
        let (head, total) = match size {
            0 => (8usize, (buf.len() - at) as u64),
            1 => (16usize, be64(buf, at + 8).unwrap_or(0)),
            n => (8usize, n),
        };
        if total < head as u64 || at as u64 + total > buf.len() as u64 {
            break;
        }
        out.push((ty, &buf[at + head..at + total as usize]));
        at += total as usize;
    }
    out
}

fn find<'a>(list: &[([u8; 4], &'a [u8])], ty: &[u8; 4]) -> Option<&'a [u8]> {
    list.iter().find(|(t, _)| t == ty).map(|(_, p)| *p)
}

/// Parses the payload of a `moov` box.
pub fn parse_moov(moov: &[u8]) -> Result<VideoInfo, String> {
    let top = boxes(moov);
    for (ty, trak) in &top {
        if ty != b"trak" {
            continue;
        }
        let t = boxes(trak);
        let Some(mdia) = find(&t, b"mdia") else { continue };
        let m = boxes(mdia);
        let is_video = find(&m, b"hdlr").and_then(|h| h.get(8..12)).map(|h| h == b"vide").unwrap_or(false);
        if !is_video {
            continue;
        }
        let mdhd = find(&m, b"mdhd").ok_or("The video track has no timing header.")?;
        let (timescale, duration) = if mdhd.first() == Some(&1) { (be32(mdhd, 20), be64(mdhd, 24)) } else { (be32(mdhd, 12), be32(mdhd, 16).map(u64::from)) };
        let (timescale, duration) = (timescale.filter(|t| *t > 0).ok_or("The video timing is invalid.")?, duration.unwrap_or(0));
        let minf = boxes(find(&m, b"minf").ok_or("The video track has no media information.")?);
        let stbl = boxes(find(&minf, b"stbl").ok_or("The video track has no sample table.")?);
        let stts = find(&stbl, b"stts").ok_or("The video track has no frame timing.")?;
        let entries = be32(stts, 4).unwrap_or(0) as usize;
        let mut counts: Vec<(u32, u64)> = Vec::new();
        for i in 0..entries.min(100_000) {
            let (Some(c), Some(d)) = (be32(stts, 8 + i * 8), be32(stts, 12 + i * 8)) else { break };
            if d == 0 {
                continue;
            }
            match counts.iter_mut().find(|(delta, _)| *delta == d) {
                Some(e) => e.1 += c as u64,
                None => counts.push((d, c as u64)),
            }
        }
        let delta = counts.iter().max_by_key(|(_, n)| *n).map(|(d, _)| *d).ok_or("The video has no frames.")?;
        let g = gcd(timescale, delta).max(1);
        let (width, height) = find(&t, b"tkhd")
            .map(|h| if h.first() == Some(&1) { (be32(h, 88), be32(h, 92)) } else { (be32(h, 76), be32(h, 80)) })
            .map(|(w, h)| (w.unwrap_or(0) >> 16, h.unwrap_or(0) >> 16))
            .unwrap_or((0, 0));
        return Ok(VideoInfo { container: "mp4".into(), known: true, fps_num: timescale / g, fps_den: delta / g, duration_sec: duration as f64 / timescale as f64, width, height });
    }
    Err("No video track was found in this file.".into())
}

/// Reads an MP4 or MOV file's top-level boxes without loading the whole file, then parses `moov`.
pub fn probe_mp4<R: Read + Seek>(r: &mut R) -> Result<VideoInfo, String> {
    let len = r.seek(SeekFrom::End(0)).map_err(|_| "Could not read the video.".to_string())?;
    let mut at = 0u64;
    while at + 8 <= len {
        r.seek(SeekFrom::Start(at)).map_err(|_| "Could not read the video.".to_string())?;
        let mut h = [0u8; 16];
        let n = r.read(&mut h).map_err(|_| "Could not read the video.".to_string())?;
        if n < 8 {
            break;
        }
        let size = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) as u64;
        let (head, total) = match size {
            0 => (8u64, len - at),
            1 if n >= 16 => (16u64, u64::from_be_bytes([h[8], h[9], h[10], h[11], h[12], h[13], h[14], h[15]])),
            s => (8u64, s),
        };
        if total < head || at + total > len {
            break;
        }
        if &h[4..8] == b"moov" {
            let size = total - head;
            if size > MAX_MOOV {
                return Err("The video's header is unusually large.".into());
            }
            let mut buf = vec![0u8; size as usize];
            r.seek(SeekFrom::Start(at + head)).map_err(|_| "Could not read the video.".to_string())?;
            r.read_exact(&mut buf).map_err(|_| "Could not read the video's header.".to_string())?;
            return parse_moov(&buf);
        }
        at += total;
    }
    Err("This looks like an MP4 or MOV file, but its header could not be found.".into())
}

pub fn probe(path: &Path) -> Result<VideoInfo, String> {
    let ext = ext_of(path).ok_or("That is not a video type Greenroom can open (MP4, MOV, M4V, WebM, MKV, AVI, MPEG).")?;
    if !path.is_file() {
        return Err("That video file could not be found.".into());
    }
    if matches!(ext.as_str(), "mp4" | "mov" | "m4v") {
        let mut f = File::open(path).map_err(|_| "Could not open the video.".to_string())?;
        return probe_mp4(&mut f);
    }
    Ok(VideoInfo { container: ext, known: false, fps_num: 0, fps_den: 0, duration_sec: 0.0, width: 0, height: 0 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn bx(ty: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut v = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend(ty);
        v.extend(payload);
        v
    }
    fn u32b(n: u32) -> Vec<u8> {
        n.to_be_bytes().to_vec()
    }

    fn video_trak(timescale: u32, duration: u32, stts: &[(u32, u32)], w: u32, h: u32) -> Vec<u8> {
        let mut mdhd = u32b(0);
        mdhd.extend(u32b(0));
        mdhd.extend(u32b(0));
        mdhd.extend(u32b(timescale));
        mdhd.extend(u32b(duration));
        mdhd.extend([0u8; 4]);
        let mut hdlr = u32b(0);
        hdlr.extend(u32b(0));
        hdlr.extend(b"vide");
        hdlr.extend([0u8; 12]);
        let mut st = u32b(0);
        st.extend(u32b(stts.len() as u32));
        for (c, d) in stts {
            st.extend(u32b(*c));
            st.extend(u32b(*d));
        }
        let stbl = bx(b"stbl", &bx(b"stts", &st));
        let minf = bx(b"minf", &stbl);
        let mut mdia = bx(b"mdhd", &mdhd);
        mdia.extend(bx(b"hdlr", &hdlr));
        mdia.extend(minf);
        let mut tkhd = vec![0u8; 84];
        tkhd[76..80].copy_from_slice(&(w << 16).to_be_bytes());
        tkhd[80..84].copy_from_slice(&(h << 16).to_be_bytes());
        let mut trak = bx(b"tkhd", &tkhd);
        trak.extend(bx(b"mdia", &mdia));
        bx(b"trak", &trak)
    }

    fn audio_trak() -> Vec<u8> {
        let mut hdlr = u32b(0);
        hdlr.extend(u32b(0));
        hdlr.extend(b"soun");
        hdlr.extend([0u8; 12]);
        bx(b"trak", &bx(b"mdia", &bx(b"hdlr", &hdlr)))
    }

    fn mp4(moov_first: bool, trak: &[u8]) -> Vec<u8> {
        let ftyp = bx(b"ftyp", b"isom0000isom");
        let mdat = bx(b"mdat", &[7u8; 1000]);
        let mut moov_payload = audio_trak();
        moov_payload.extend(trak);
        let moov = bx(b"moov", &moov_payload);
        let mut f = ftyp;
        if moov_first {
            f.extend(moov);
            f.extend(mdat);
        } else {
            f.extend(mdat);
            f.extend(moov);
        }
        f
    }

    #[test]
    fn reads_23_976_as_an_exact_fraction() {
        // 240 frames at 24000/1001: timescale 24000, every frame lasts 1001 ticks.
        let f = mp4(true, &video_trak(24000, 240 * 1001, &[(240, 1001)], 1920, 1080));
        let i = probe_mp4(&mut Cursor::new(f)).unwrap();
        assert_eq!((i.fps_num, i.fps_den), (24000, 1001));
        assert!((i.duration_sec - 10.01).abs() < 1e-9);
        assert_eq!((i.width, i.height), (1920, 1080));
        assert!(i.known);
    }

    #[test]
    fn reads_whole_frame_rates_and_reduces_them() {
        let f = mp4(true, &video_trak(90000, 90000 * 5, &[(125, 3600)], 1280, 720));
        let i = probe_mp4(&mut Cursor::new(f)).unwrap();
        assert_eq!((i.fps_num, i.fps_den), (25, 1));
        let g = mp4(true, &video_trak(30000, 30000, &[(30, 1001)], 640, 360));
        assert_eq!(probe_mp4(&mut Cursor::new(g)).map(|i| (i.fps_num, i.fps_den)), Ok((30000, 1001)));
    }

    #[test]
    fn finds_moov_at_the_end_and_picks_the_most_common_frame_time() {
        // A stray longer frame does not change the rate.
        let f = mp4(false, &video_trak(24000, 100_000, &[(1, 2002), (99, 1000)], 100, 50));
        let i = probe_mp4(&mut Cursor::new(f)).unwrap();
        assert_eq!((i.fps_num, i.fps_den), (24, 1));
    }

    #[test]
    fn says_so_when_there_is_no_video_or_no_header() {
        let mut f = bx(b"ftyp", b"isom0000isom");
        f.extend(bx(b"moov", &audio_trak()));
        assert!(probe_mp4(&mut Cursor::new(f)).unwrap_err().contains("No video track"));
        assert!(probe_mp4(&mut Cursor::new(bx(b"ftyp", b"isom"))).unwrap_err().contains("header could not be found"));
        assert!(probe_mp4(&mut Cursor::new(vec![0u8; 3])).is_err());
    }

    #[test]
    fn ignores_garbage_sizes_without_panicking() {
        let mut f = u32b(1_000_000).to_vec();
        f.extend(b"moov");
        f.extend([1u8; 40]);
        assert!(probe_mp4(&mut Cursor::new(f)).is_err());
    }

    #[test]
    fn only_known_video_extensions_are_accepted() {
        assert_eq!(ext_of(Path::new("C:\\a\\Film.MOV")).as_deref(), Some("mov"));
        assert_eq!(ext_of(Path::new("a.exe")), None);
        assert_eq!(ext_of(Path::new("noext")), None);
        assert!(probe(Path::new("C:\\nowhere\\x.mp4")).unwrap_err().contains("could not be found"));
        assert!(probe(Path::new("C:\\x\\malware.exe")).unwrap_err().contains("not a video type"));
    }
}
