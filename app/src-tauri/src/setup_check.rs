//! Helping a person find out why an engine did not install: a log of every setup step, a check of the usual causes (disk space,
//! the internet addresses the installers need, the Hugging Face account), and a report that can be copied and sent.
//! Nothing here installs anything, and nothing it writes or returns contains a key.

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct CheckItem {
    pub name: String,
    pub ok: bool,
    pub detail: String,
    /// What to do about it, in plain words. Empty when it is fine.
    pub fix: String,
}

pub fn log_path(root: &Path) -> PathBuf {
    root.join("logs").join("setup.log")
}

const MAX_LOG: u64 = 1 << 20;

/// Adds text to the setup log, keeping the file under about 1 MB (the oldest half is dropped). Failures to log are ignored.
pub fn append_log(root: &Path, text: &str) {
    let path = log_path(root);
    let Some(dir) = path.parent() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    if std::fs::metadata(&path).map(|m| m.len() > MAX_LOG).unwrap_or(false) {
        if let Ok(old) = std::fs::read(&path) {
            let keep = &old[old.len() / 2..];
            let _ = std::fs::write(&path, keep);
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(text.as_bytes());
    }
}

/// The last lines of the setup log.
pub fn log_tail(root: &Path, lines: usize) -> String {
    let text = std::fs::read(log_path(root)).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

/// The part of a failed command's output that says why, not the noise before it: error lines if there are any, else the last lines.
pub fn why(output: &str) -> String {
    let lines: Vec<&str> = output.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let errs: Vec<&str> = lines.iter().copied().filter(|l| l.to_ascii_lowercase().contains("error") || l.starts_with("ERROR")).collect();
    let pick: Vec<&str> = if errs.is_empty() { lines[lines.len().saturating_sub(3)..].to_vec() } else { errs[errs.len().saturating_sub(3)..].to_vec() };
    let joined = pick.join(" | ");
    let n = joined.chars().count();
    if n > 400 { joined.chars().skip(n - 400).collect() } else { joined }
}

/// Whether a failure looks like a network hiccup worth trying again.
pub fn looks_temporary(output: &str) -> bool {
    let t = output.to_ascii_lowercase();
    ["timed out", "timeout", "connection reset", "connection aborted", "max retries", "temporary failure", "read error", "incompleteread", "connection broken", "remote end closed", "ssl"].iter().any(|k| t.contains(k))
}

/// Free space on the drive that holds `path`, in whole GB, if it can be found.
pub fn free_gb(path: &Path) -> Option<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let p = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    disks.list().iter().filter(|d| p.starts_with(d.mount_point()) || p.to_string_lossy().trim_start_matches(r"\\?\").starts_with(&d.mount_point().to_string_lossy().to_string())).max_by_key(|d| d.mount_point().as_os_str().len()).map(|d| d.available_space() / (1 << 30))
}

pub fn disk_check(root: &Path, need_gb: u64) -> CheckItem {
    match free_gb(root) {
        Some(g) if g >= need_gb => CheckItem { name: "Disk space".into(), ok: true, detail: format!("{g} GB free (about {need_gb} GB needed)"), fix: String::new() },
        Some(g) => CheckItem { name: "Disk space".into(), ok: false, detail: format!("{g} GB free, about {need_gb} GB needed"), fix: "Free some space on the drive that holds your Documents folder, then try again.".into() },
        None => CheckItem { name: "Disk space".into(), ok: true, detail: "could not be measured".into(), fix: String::new() },
    }
}

/// Whether an address answers at all (any HTTP answer counts; only a failure to connect does not).
pub fn reach(name: &str, url: &str, fix: &str) -> CheckItem {
    let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(8)).timeout(Duration::from_secs(12)).redirects(2).build();
    match agent.head(url).call() {
        Ok(_) | Err(ureq::Error::Status(_, _)) => CheckItem { name: name.into(), ok: true, detail: "reachable".into(), fix: String::new() },
        Err(ureq::Error::Transport(t)) => CheckItem { name: name.into(), ok: false, detail: format!("could not connect ({})", crate::net::short(&t.to_string())), fix: fix.into() },
    }
}

pub fn path_check(root: &Path) -> CheckItem {
    let n = root.to_string_lossy().chars().count();
    if n > 100 {
        CheckItem { name: "Folder path length".into(), ok: false, detail: format!("{n} characters"), fix: "Windows can fail on very long folder paths. Move your Documents folder to a shorter path, or turn on Windows long paths.".into() }
    } else {
        CheckItem { name: "Folder path length".into(), ok: true, detail: format!("{n} characters"), fix: String::new() }
    }
}

/// Plain text for sharing: the checks and the end of the log. It never contains a key (the log holds only command output).
pub fn report(version: &str, root: &Path, checks: &[CheckItem]) -> String {
    let mut s = format!("Greenroom Local {version}\nOS: {} {}\nFolder: {}\n\nChecks:\n", std::env::consts::OS, sysinfo::System::long_os_version().unwrap_or_default(), root.display());
    for c in checks {
        s.push_str(&format!("{} {}: {}{}\n", if c.ok { "ok  " } else { "FAIL" }, c.name, c.detail, if c.fix.is_empty() { String::new() } else { format!(" -> {}", c.fix) }));
    }
    s.push_str("\nLast lines of the setup log:\n");
    s.push_str(&log_tail(root, 120));
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_reason_is_the_error_line_not_the_noise_before_it() {
        let out = "Collecting torch\n  Downloading torch-2.6.0.whl (200 MB)\nWARNING: retrying\nERROR: Could not find a version that satisfies the requirement foo\nERROR: No matching distribution found for foo\n";
        let w = why(out);
        assert!(w.contains("No matching distribution found for foo"), "{w}");
        assert!(!w.contains("Collecting torch"));
        assert!(why("a\nb\nc\nd\ne\n").ends_with("c | d | e") || why("a\nb\nc\nd\ne\n") == "c | d | e");
        assert_eq!(why(""), "");
        assert!(why(&"x".repeat(5000)).chars().count() <= 400);
    }

    #[test]
    fn network_failures_are_recognised_as_worth_a_retry() {
        assert!(looks_temporary("ReadTimeoutError: HTTPSConnectionPool: Read timed out."));
        assert!(looks_temporary("Connection reset by peer"));
        assert!(!looks_temporary("ERROR: No matching distribution found for foo"));
        assert!(!looks_temporary("SyntaxError: invalid syntax"));
    }

    #[test]
    fn the_log_is_appended_tailed_and_kept_small() {
        let dir = std::env::temp_dir().join(format!("gr-setuplog-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        append_log(&dir, "line one\nline two\n");
        append_log(&dir, "line three\n");
        assert_eq!(log_tail(&dir, 2), "line two\nline three");
        assert_eq!(log_tail(&dir, 99), "line one\nline two\nline three");
        let big = "x".repeat(1000) + "\n";
        for _ in 0..1300 {
            append_log(&dir, &big);
        }
        assert!(std::fs::metadata(log_path(&dir)).unwrap().len() < (1 << 20) + 4096);
        append_log(&dir, "the very last line\n");
        assert_eq!(log_tail(&dir, 1), "the very last line");
        assert_eq!(log_tail(&dir.join("missing"), 5), "");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn checks_report_plainly() {
        let dir = std::env::temp_dir();
        let d = disk_check(&dir, 1);
        assert!(d.ok || !d.fix.is_empty());
        assert!(!disk_check(&dir, 100_000_000).ok || free_gb(&dir).is_none());
        assert!(path_check(Path::new("C:/short")).ok);
        assert!(!path_check(Path::new(&format!("C:/{}", "a".repeat(120)))).ok);
        let r = report("0.0.0", &dir, &[CheckItem { name: "Disk space".into(), ok: false, detail: "1 GB free".into(), fix: "Free some space".into() }]);
        assert!(r.contains("FAIL Disk space: 1 GB free -> Free some space") && r.contains("Last lines of the setup log"));
        let down = reach("Nowhere", "http://127.0.0.1:9/", "Check the firewall");
        assert!(!down.ok && down.fix == "Check the firewall");
    }
}
