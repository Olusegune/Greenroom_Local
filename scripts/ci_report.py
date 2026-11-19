"""Turns the logs of a failed `cargo clippy` / `cargo test` run into GitHub annotations.

GitHub does not show a build log to anyone who is not signed in, but it does show annotations. The macOS job runs the Rust checks as
advisory (the installer is still built) and calls this to put the actual error text where it can be read.

Usage: python3 scripts/ci_report.py <folder holding clippy.log and test.log> <clippy exit code> <test exit code>
"""
import re
import sys

NL = chr(10)


def keep_lines(text):
    lines = text.splitlines()
    keep = []
    for i, line in enumerate(lines):
        failed_test = line.startswith("test ") and line.rstrip().endswith("FAILED")
        if re.match(r"^(error|warning)", line) or "panicked at" in line or failed_test or "could not compile" in line:
            keep.extend(lines[i:i + 7])
            keep.append("--")
    return keep


def annotate(title, path):
    text = open(path, encoding="utf8", errors="replace").read()
    body = NL.join(keep_lines(text))[:9000] or text[-4000:]
    # GitHub reads %, carriage returns and line breaks in a workflow command in this escaped form
    body = body.replace("%", "%25").replace(chr(13), "").replace(NL, "%0A")
    print(f"::error title={title} (macOS)::{body}")


def main():
    folder, clippy_exit, test_exit = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    if clippy_exit:
        annotate("cargo clippy failed", folder + "/clippy.log")
    if test_exit:
        annotate("cargo test failed", folder + "/test.log")
    print("clippy exit", clippy_exit, "| test exit", test_exit)


if __name__ == "__main__":
    main()
