"""Checks the silence trimmer of runtime/chatterbox_once.py against real generated files.
Usage: <chatterbox python> trim_check.py <folder with .wav files>
Prints each file's length before and after trimming; the speech must be kept and the long silent tail removed."""
import glob
import os
import sys
import textwrap

import numpy as np
import torch
from scipy.io import wavfile

src = open(os.path.join(os.path.dirname(__file__), "..", "..", "runtime", "chatterbox_once.py"), encoding="utf8").read()
start = src.index("    def trim_tail")
end = src.index("\n    device", start)
ns = {"torch": torch}
exec(textwrap.dedent(src[start:end]), ns)
trim = ns["trim_tail"]

for p in sorted(glob.glob(os.path.join(sys.argv[1], "*.wav"))):
    sr, a = wavfile.read(p)
    w = torch.from_numpy(a.astype(np.float32)).unsqueeze(0)
    t = trim(w, sr)
    print(f"{os.path.basename(p):24s} {w.shape[-1] / sr:6.2f}s -> {t.shape[-1] / sr:5.2f}s")
print("silence only is left alone:", trim(torch.zeros(1, 24000), 24000).shape[-1] == 24000)
print("empty audio is safe:", trim(torch.zeros(1, 0), 24000).shape[-1] == 0)
