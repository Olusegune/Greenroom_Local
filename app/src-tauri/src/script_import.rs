//! Reading a script file from the owner's computer: plain text, Markdown, Fountain, Word (.docx) and PDF.
//!
//! The file is untrusted bytes, so: the extension must be one of these five and the file's own first bytes must agree with
//! it; the file is at most 20 MB; a Word file is opened as an archive only to read the one part `word/document.xml` (nothing
//! is ever written to disk, no entry name is used as a path, the decompressed size is capped and the number of entries is
//! capped); that XML is read by a small scanner that resolves no entities and fetches nothing; a PDF is parsed in memory with a
//! page cap and a panic guard; and the text that comes out is cleaned of control characters and capped.

use std::io::{Cursor, Read};
use std::path::Path;

pub const MAX_FILE: u64 = 20 << 20;
pub const MAX_TEXT_CHARS: usize = 2_000_000;
const MAX_XML: u64 = 32 << 20;
const MAX_ENTRIES: usize = 4000;
const MAX_PAGES: usize = 400;

#[derive(Debug, PartialEq)]
pub struct Imported {
    pub text: String,
    /// "text", "fountain", "word" or "pdf".
    pub format: &'static str,
    pub truncated: bool,
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// Reads and converts one script file. Errors are written for the owner.
pub fn read_script(path: &Path) -> Result<Imported, String> {
    let ext = extension(path);
    if !matches!(ext.as_str(), "txt" | "md" | "markdown" | "fountain" | "docx" | "pdf") {
        return Err("Choose a .txt, .md, .fountain, .docx or .pdf file.".into());
    }
    let meta = std::fs::metadata(path).map_err(|_| "Greenroom could not open that file.".to_string())?;
    if !meta.is_file() {
        return Err("That is not a file.".into());
    }
    if meta.len() == 0 {
        return Err("That file is empty.".into());
    }
    if meta.len() > MAX_FILE {
        return Err("That file is over 20 MB, which is too large for a script.".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path).and_then(|f| f.take(MAX_FILE + 1).read_to_end(&mut bytes)).map_err(|_| "Greenroom could not read that file.".to_string())?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("That file is over 20 MB, which is too large for a script.".into());
    }
    convert(&ext, &bytes)
}

/// The conversion on its own, so it can be tested without files.
pub fn convert(ext: &str, bytes: &[u8]) -> Result<Imported, String> {
    let (raw, format) = match ext {
        "docx" => {
            if !bytes.starts_with(b"PK\x03\x04") {
                return Err("That file is not really a Word document, whatever its name says.".into());
            }
            (docx_text(bytes)?, "word")
        }
        "pdf" => {
            if !bytes.starts_with(b"%PDF-") {
                return Err("That file is not really a PDF, whatever its name says.".into());
            }
            (pdf_text(bytes)?, "pdf")
        }
        _ => {
            if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"%PDF-") || bytes.starts_with(b"MZ") || bytes.starts_with(b"\x7fELF") {
                return Err("That file is not plain text, whatever its name says. Save it as .docx or .pdf to import it.".into());
            }
            (decode_text(bytes)?, if ext == "fountain" { "fountain" } else { "text" })
        }
    };
    let (text, truncated) = clean(&raw);
    if text.trim().is_empty() {
        return Err(if format == "pdf" { "That PDF has no selectable text (it may be a scan). Save a text version of the script and import that.".into() } else { "That file has no text in it.".into() });
    }
    Ok(Imported { text, format, truncated })
}

/// UTF-8 (with or without a BOM) or UTF-16 with a BOM (what Windows Notepad can save). A file with NUL bytes that is not UTF-16 is not text.
fn decode_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let le = bytes[0] == 0xff;
        let units: Vec<u16> = bytes[2..].chunks_exact(2).map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) }).collect();
        return Ok(String::from_utf16_lossy(&units));
    }
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Err("That file is not plain text.".into());
    }
    let s = String::from_utf8_lossy(bytes);
    Ok(s.strip_prefix('\u{feff}').unwrap_or(&s).to_string())
}

/// Control characters out (tab and line breaks stay), line breaks made uniform, and the length capped on a line boundary.
fn clean(raw: &str) -> (String, bool) {
    let mut out = String::with_capacity(raw.len().min(MAX_TEXT_CHARS + 1024));
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push('\n');
            }
            '\u{2028}' | '\u{2029}' | '\u{0b}' | '\u{0c}' => out.push('\n'),
            '\n' | '\t' => out.push(c),
            c if c.is_control() || ('\u{200b}'..='\u{200f}').contains(&c) || ('\u{202a}'..='\u{202e}').contains(&c) || ('\u{2066}'..='\u{2069}').contains(&c) || c == '\u{feff}' => {}
            c => out.push(c),
        }
    }
    if out.chars().count() <= MAX_TEXT_CHARS {
        return (out, false);
    }
    let cut: String = out.chars().take(MAX_TEXT_CHARS).collect();
    let end = cut.rfind('\n').unwrap_or(cut.len());
    (cut[..end].to_string(), true)
}

// ---- Word ----------------------------------------------------------------------------------------------------------

fn docx_text(bytes: &[u8]) -> Result<String, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "That Word file could not be opened. It may be damaged or password-protected.".to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("That Word file has too many parts to open safely.".into());
    }
    let mut xml = String::new();
    let mut found = false;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|_| "That Word file could not be opened. It may be damaged or password-protected.".to_string())?;
        // the name is only compared, never used as a path
        if !f.name().map(|n| n == "word/document.xml").unwrap_or(false) {
            continue;
        }
        if f.size() > MAX_XML {
            return Err("That Word file expands to more than it is safe to open.".into());
        }
        let mut buf = Vec::new();
        (&mut f).take(MAX_XML + 1).read_to_end(&mut buf).map_err(|_| "That Word file could not be read.".to_string())?;
        if buf.len() as u64 > MAX_XML {
            return Err("That Word file expands to more than it is safe to open.".into());
        }
        xml = String::from_utf8_lossy(&buf).into_owned();
        found = true;
        break;
    }
    if !found {
        return Err("That does not look like a Word document (it has no document part).".into());
    }
    Ok(xml_paragraphs(&xml))
}

/// The text of a Word document: one line per paragraph, tabs and breaks kept. Only a few named entities and numeric character
/// references are decoded; nothing else is resolved and no external reference is followed.
fn xml_paragraphs(xml: &str) -> String {
    let mut out = String::new();
    let b = xml.as_bytes();
    let mut i = 0;
    let mut in_text = false;
    while i < b.len() {
        if b[i] == b'<' {
            let end = match xml[i..].find('>') {
                Some(e) => i + e,
                None => break,
            };
            let tag = &xml[i + 1..end];
            let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("");
            let closing = tag.starts_with('/');
            match (name, closing) {
                ("w:t", false) => in_text = !tag.ends_with('/'),
                ("w:t", true) => in_text = false,
                ("w:tab", false) => out.push('\t'),
                ("w:br", false) | ("w:cr", false) => out.push('\n'),
                ("w:p", true) => out.push('\n'),
                _ => {}
            }
            i = end + 1;
        } else {
            let next = xml[i..].find('<').map(|n| i + n).unwrap_or(b.len());
            if in_text {
                out.push_str(&decode_entities(&xml[i..next]));
            }
            i = next;
        }
    }
    out
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        out.push_str(&rest[..p]);
        rest = &rest[p..];
        match rest.find(';').filter(|&e| e <= 10) {
            Some(e) => {
                let ent = &rest[1..e];
                let ch = match ent {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    _ => ent
                        .strip_prefix('#')
                        .and_then(|n| if let Some(h) = n.strip_prefix(['x', 'X']) { u32::from_str_radix(h, 16).ok() } else { n.parse::<u32>().ok() })
                        .and_then(char::from_u32),
                };
                match ch {
                    Some(c) => out.push(c),
                    None => out.push_str(&rest[..=e]),
                }
                rest = &rest[e + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

// ---- PDF -----------------------------------------------------------------------------------------------------------

fn pdf_text(bytes: &[u8]) -> Result<String, String> {
    let owned = bytes.to_vec();
    // a damaged PDF must never take the app down: a panic inside the parser becomes an ordinary error
    let result = std::panic::catch_unwind(move || -> Result<String, String> {
        let doc = lopdf::Document::load_mem(&owned).map_err(|_| "That PDF could not be read. It may be damaged.".to_string())?;
        if doc.is_encrypted() {
            return Err("That PDF is password-protected. Remove the password and try again.".into());
        }
        let pages: Vec<u32> = doc.get_pages().keys().copied().collect();
        if pages.is_empty() {
            return Err("That PDF has no pages.".into());
        }
        if pages.len() > MAX_PAGES {
            return Err(format!("That PDF has {} pages; at most {MAX_PAGES} can be imported.", pages.len()));
        }
        let mut out = String::new();
        for p in pages {
            if let Ok(t) = doc.extract_text(&[p]) {
                out.push_str(&t);
                out.push_str("\n\n");
            }
            if out.len() > MAX_TEXT_CHARS * 4 {
                break;
            }
        }
        Ok(out)
    });
    result.unwrap_or_else(|_| Err("That PDF could not be read safely.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn docx(document_xml: &str) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        w.start_file("[Content_Types].xml", o).unwrap();
        w.write_all(b"<Types/>").unwrap();
        w.start_file("word/document.xml", o).unwrap();
        w.write_all(document_xml.as_bytes()).unwrap();
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn plain_text_is_decoded_cleaned_and_capped() {
        let t = convert("txt", b"\xef\xbb\xbfADA: Hello.\r\nTUNDE: Hi\x01 there\x07.\r\n").unwrap();
        assert_eq!(t.format, "text");
        assert_eq!(t.text, "ADA: Hello.\nTUNDE: Hi there.\n");
        assert_eq!(convert("fountain", b"INT. KITCHEN - DAY\n").unwrap().format, "fountain");
        let utf16: Vec<u8> = [0xff, 0xfe].into_iter().chain("ADA: Ol\u{e1}\n".encode_utf16().flat_map(|u| u.to_le_bytes())).collect();
        assert_eq!(convert("txt", &utf16).unwrap().text, "ADA: Ol\u{e1}\n");
        let big = "x\n".repeat(MAX_TEXT_CHARS);
        let c = convert("txt", big.as_bytes()).unwrap();
        assert!(c.truncated && c.text.chars().count() <= MAX_TEXT_CHARS);
        assert!(c.text.ends_with('x'));
        // bidi and invisible characters are removed
        assert_eq!(convert("txt", "A\u{202e}B\u{200b}C".as_bytes()).unwrap().text, "ABC");
    }

    #[test]
    fn a_program_or_archive_renamed_to_text_is_refused() {
        for bad in [&b"MZ\x90\x00"[..], b"\x7fELF\x02", b"PK\x03\x04abc", b"%PDF-1.7 x", b"a\x00b\x00c\x00"] {
            assert!(convert("txt", bad).is_err(), "{bad:?}");
        }
        assert!(convert("docx", b"just text").unwrap_err().contains("not really a Word"));
        assert!(convert("pdf", b"just text").unwrap_err().contains("not really a PDF"));
        assert!(convert("txt", b"   \n  ").unwrap_err().contains("no text"));
    }

    #[test]
    fn word_paragraphs_become_lines_and_entities_are_decoded_but_nothing_is_fetched() {
        let xml = r#"<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini">]><w:document><w:body>
            <w:p><w:r><w:t>INT. KITCHEN - DAY</w:t></w:r></w:p>
            <w:p><w:r><w:t xml:space="preserve">ADA: Fish &amp; chips &#8211; &#x263A; &xxe; &bogus; stays</w:t></w:r><w:r><w:tab/><w:t>(beat)</w:t></w:r><w:r><w:br/></w:r></w:p>
            <w:p><w:pPr><w:pStyle w:val="x"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>TUNDE: Hi.</w:t></w:r></w:p></w:body></w:document>"#;
        let t = convert("docx", &docx(xml)).unwrap();
        assert_eq!(t.format, "word");
        assert!(t.text.contains("INT. KITCHEN - DAY\n"));
        assert!(t.text.contains("ADA: Fish & chips \u{2013} \u{263a} &xxe; &bogus; stays\t(beat)\n"), "{:?}", t.text);
        assert!(t.text.contains("TUNDE: Hi.\n"));
        assert!(!t.text.contains("win.ini") && !t.text.contains("Windows"));
    }

    #[test]
    fn a_word_file_without_the_document_part_a_bomb_or_garbage_is_refused() {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        w.start_file("other.txt", o).unwrap();
        w.write_all(b"x").unwrap();
        let no_doc = w.finish().unwrap().into_inner();
        assert!(convert("docx", &no_doc).unwrap_err().contains("no document part"));
        assert!(convert("docx", b"PK\x03\x04garbage").is_err());
        // a part that claims to be enormous is refused before it is read
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let d = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        w.start_file("word/document.xml", d).unwrap();
        let chunk = vec![b'a'; 1 << 20];
        for _ in 0..40 {
            w.write_all(&chunk).unwrap();
        }
        let bomb = w.finish().unwrap().into_inner();
        assert!(bomb.len() < 1 << 20, "the test archive should be small: {}", bomb.len());
        assert!(convert("docx", &bomb).unwrap_err().contains("expands"));
        // a file name that looks like a path is never used as one
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        w.start_file("../../evil.txt", o).unwrap();
        w.write_all(b"x").unwrap();
        w.start_file("word/document.xml", o).unwrap();
        w.write_all(b"<w:p><w:t>ok</w:t></w:p>").unwrap();
        assert_eq!(convert("docx", &w.finish().unwrap().into_inner()).unwrap().text.trim(), "ok");
    }

    fn pdf_with(text: &str) -> Vec<u8> {
        use lopdf::{dictionary, Document, Object, Stream};
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
        let resources_id = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font_id } });
        let content = format!("BT /F1 12 Tf 72 700 Td ({text}) Tj ET");
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let page_id = doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id, "Contents" => content_id, "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()], "Resources" => resources_id });
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 }));
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    #[test]
    fn pdf_text_is_read_and_bad_pdfs_are_refused_without_crashing() {
        let t = convert("pdf", &pdf_with("ADA: Hello from a PDF.")).unwrap();
        assert_eq!(t.format, "pdf");
        assert!(t.text.contains("ADA: Hello from a PDF."), "{:?}", t.text);
        assert!(convert("pdf", b"%PDF-1.4\nnot really a pdf").is_err());
        assert!(convert("pdf", &pdf_with("")).unwrap_err().contains("no selectable text"));
        let mut cut = pdf_with("x");
        cut.truncate(cut.len() / 2);
        assert!(convert("pdf", &cut).is_err());
        for n in [0usize, 5, 50] {
            let mut junk = b"%PDF-1.7\n".to_vec();
            junk.extend((0..n).map(|i| (i * 31 % 251) as u8));
            let _ = convert("pdf", &junk); // must return, not panic
        }
    }

    #[test]
    fn files_are_checked_before_they_are_read() {
        let dir = std::env::temp_dir().join(format!("gr-script-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("a.txt");
        std::fs::write(&ok, "ADA: hi\n").unwrap();
        assert_eq!(read_script(&ok).unwrap().text, "ADA: hi\n");
        assert!(read_script(&dir.join("a.exe")).unwrap_err().contains("Choose a"));
        assert!(read_script(&dir.join("missing.txt")).is_err());
        assert!(read_script(&dir).is_err());
        let empty = dir.join("e.txt");
        std::fs::write(&empty, "").unwrap();
        assert!(read_script(&empty).unwrap_err().contains("empty"));
        let wrong = dir.join("w.docx");
        std::fs::write(&wrong, "plain text in a docx").unwrap();
        assert!(read_script(&wrong).unwrap_err().contains("not really a Word"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
