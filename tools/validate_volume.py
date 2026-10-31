"""Validate generated volume assets against the original DICOM series."""
import sys, json
from pathlib import Path
import numpy as np
import pydicom
from PIL import Image

root = Path(sys.argv[1])
data = root / "public" / "data"
meta = json.loads((data / "volume.json").read_text(encoding="utf-8"))
print(json.dumps(meta["volume"], indent=2)[:800])

dims = meta["volume"]["dims"]  # x,y,z
W, H, D = dims
u8 = np.fromfile(data / meta["files"]["u8"], dtype=np.uint8).reshape(D, H, W)
i16 = np.fromfile(data / meta["files"]["i16"], dtype=np.int16).reshape(D, H, W)
print("u8 shape", u8.shape, "min/max", u8.min(), u8.max())
print("i16 shape", i16.shape, "min/max", i16.min(), i16.max())

# Ground truth: read full-res series and area-average 2x2x2 for slice ranges
series = Path(meta["source"]["directory"])
if not series.is_absolute():
    series = root / series
files = sorted(series.glob("Slice_*.dcm"))
print("rechecking against", len(files), "DICOM slices")
for out_z in (10, 100, 190):
    stack = np.stack([pydicom.dcmread(files[2 * out_z + k]).pixel_array.astype(np.int32) for k in range(2)])
    truth = (
        stack.reshape(1, 2, H * 2 // 2, 2, W * 2 // 2, 2)
        .mean(axis=(1, 3, 5))
        .round()
        .astype(np.int16)[0]
    )
    diff = np.abs(truth.astype(np.int32) - i16[out_z].astype(np.int32))
    print(f"z={out_z}: max abs diff vs DICOM = {diff.max()}, mean = {diff.mean():.3f}")
    # 8-bit dequantization error
    qmin, qmax = meta["volume"]["quantRange"]
    deq = np.round(u8[out_z].astype(np.float32) / 255 * (qmax - qmin) + qmin)
    dq = np.abs(deq - i16[out_z]).max()
    print(f"        u8 quantization max error = {dq} HU")

# Save windowed MPR previews (bone window) for visual check
def win(sl, c=600, w=2600):
    lo, hi = c - w / 2, c + w / 2
    v = np.clip((sl.astype(np.float32) - lo) / (hi - lo), 0, 1)
    return (v * 255).astype(np.uint8)

out = root / "tools" / "preview"
out.mkdir(exist_ok=True)
Image.fromarray(win(i16[100])).save(out / "axial.png")
Image.fromarray(win(i16[:, 160, :])[::-1]).save(out / "coronal.png")
Image.fromarray(win(i16[:, :, 160])[::-1]).save(out / "sagittal.png")
Image.fromarray(u8[100]).save(out / "axial_u8.png")
print("previews ->", out)
