"""Survey the whole CBCT series: geometry consistency, z ordering, value range."""
import sys
from pathlib import Path
import numpy as np
import pydicom

folder = Path(sys.argv[1])
files = sorted(folder.glob("Slice_*.dcm"))
print("slice count:", len(files))

zs, inst, positions, spacing, rows, cols = [], [], [], [], [], []
for f in files:
    ds = pydicom.dcmread(f, stop_before_pixels=True)
    zs.append(float(ds.ImagePositionPatient[2]))
    inst.append(int(ds.InstanceNumber))
    positions.append(tuple(float(v) for v in ds.ImagePositionPatient))
    spacing.append((float(ds.PixelSpacing[0]), float(ds.PixelSpacing[1])))
    rows.append(int(ds.Rows)); cols.append(int(ds.Columns))
    if f == files[0]:
        p0 = ds
print("rows/cols unique:", set(zip(rows, cols)))
print("pixel spacing unique:", set(spacing))
print("z increasing by filename:", all(zs[i] < zs[i+1] for i in range(len(zs)-1)))
print("z[0..4]", zs[:5], "z[-5..]", zs[-5:])
print("instance == index:", inst == list(range(1, len(inst)+1)))
print("dz unique:", sorted(set(round(zs[i+1]-zs[i], 6) for i in range(len(zs)-1)))[:10])
print("ImagePositionPatient first/last:", positions[0], positions[-1])
print("SliceThickness:", p0.SliceThickness, "SpacingBetweenSlices:", getattr(p0, "SpacingBetweenSlices", None))

# value range across whole volume (sample every 5th slice)
lo, hi = 1e9, -1e9
hist = np.zeros(4096, dtype=np.int64)
for f in files[::5]:
    ds = pydicom.dcmread(f)
    a = ds.pixel_array.astype(np.int16)
    lo = min(lo, int(a.min())); hi = max(hi, int(a.max()))
    h, _ = np.histogram(a, bins=4096, range=(-1000, 3400))
    hist += h
print("HU range (sampled):", lo, hi)
nz = np.nonzero(hist)[0]
print("hist nonzero bins first/last:", nz[:5], nz[-5:])
cum = np.cumsum(hist) / hist.sum()
for q in (0.5, 0.9, 0.99, 0.995, 0.999):
    print(f"  HU {q*100:.1f}% = { -1000 + 4400 * (np.searchsorted(cum, q)+0.5)/4096:.0f}")
print("patient name bytes:", p0.PatientName.original_string if hasattr(p0.PatientName, 'original_string') else p0.PatientName)
print("series desc:", getattr(p0, 'SeriesDescription', None))
print("study desc:", getattr(p0, 'StudyDescription', None))
