//! Windows x64 bootstrap, independent of PATH, Python launchers and user packages.
//! Pins checked against python.org and PyPI on 2026-10-30.
use std::{fs, path::{Path, PathBuf}};

const PYTHON_URL: &str = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip";
const PYTHON_SIZE: usize = 11_249_023;
const PYTHON_SHA: &str = "009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b";
const PIP_URL: &str = "https://files.pythonhosted.org/packages/c9/bc/b7db44f5f39f9d0494071bddae6880eb645970366d0a200022a1a93d57f5/pip-25.0.1-py3-none-any.whl";
const PIP_SIZE: usize = 1_841_526;
const PIP_SHA: &str = "c46efd13b6aa8279f33f2864459c8ce587ea6a1a59ee20de055868d8f7688f7f";

fn verified(url: &str, size: usize, sha: &str, fetch: crate::local::Fetch) -> Result<Vec<u8>, String> {
    let bytes = fetch(url, size as u64 + 1)?;
    if bytes.len() != size || crate::local::sha256_hex(&bytes) != sha {
        return Err("The Python runtime download failed verification. Retry setup.".into());
    }
    Ok(bytes)
}

pub fn bootstrap(dest: &Path) -> Result<PathBuf, String> {
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        return Err("Managed Python setup is currently available for Windows x64 only.".into());
    }
    // Both archives are verified before extracting any executable code.
    let python = verified(PYTHON_URL, PYTHON_SIZE, PYTHON_SHA, &crate::net::download)?;
    let pip = verified(PIP_URL, PIP_SIZE, PIP_SHA, &crate::net::download)?;
    crate::local::extract_zip(&python, dest)?;
    crate::local::extract_zip(&pip, &dest.join("Lib/site-packages"))?;
    fs::write(dest.join("python311._pth"), "python311.zip\n.\nLib/site-packages\nimport site\n")
        .map_err(|_| "Could not configure the private Python runtime.")?;
    Ok(dest.join("python.exe"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bootstrap_rejects_size_and_checksum_mismatches_before_extraction() {
        let hash = crate::local::sha256_hex(b"verified");
        assert!(verified("test", 8, &hash, &|_, _| Ok(b"verified".to_vec())).is_ok());
        assert!(verified("test", 7, &hash, &|_, _| Ok(b"verified".to_vec())).is_err());
        assert!(verified("test", 8, &hash, &|_, _| Ok(b"modified".to_vec())).is_err());
    }
}
