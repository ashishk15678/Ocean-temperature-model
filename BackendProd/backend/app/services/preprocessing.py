"""
preprocessing.py
─────────────────
Reproduces the EXACT training preprocessing pipeline from:
    NoteBooks/TRainingAndProcessingDAta5gbModel.ipynb  (Step 4 — model-ready)

Pipeline per variable (from notebook cell 25/modelready creation):

    1.  raw float32 value
    2.  validity mask  →  np.isfinite(x) ? 1.0 : 0.0
    3.  normalise      →  (x - train_mean) / train_std
    4.  fill invalid   →  normalized.fillna(0.0)   i.e. NaN → 0.0

Channel stack order (matches OceanYearDataset in Final5YearModel.ipynb):
    [sst, sss, sla, uo, vo, wind_u, wind_v,
     sst_mask, sss_mask, sla_mask, uo_mask, vo_mask, wind_u_mask, wind_v_mask]
    = 14 channels total

Input tensor to model: [B, T, 14, H, W]

Spatial grid and patching:
    PATCH_SIZE=32, PATCH_STRIDE=32  (from notebook CONFIG)
    100 / 32 → 3 full patches (positions 0, 32, 64) — 3×32=96 ≤ 100
    240 / 32 → 7 full patches (positions 0..192)   — 7×32=224 ≤ 240
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import torch

from app.core.config import (
    PATCH_SIZE,
    PATCH_STRIDE,
    SEQUENCE_LENGTH,
    SURFACE_VARS,
    TARGET_DEPTHS,
    TRAIN_STATS_PATH,
    TARGET_STATS_PATH,
    GRID_N_LAT,
    GRID_N_LON,
    GRID_LAT_START,
    GRID_LON_START,
    GRID_RESOLUTION,
)

logger = logging.getLogger(__name__)


# ── normalization stats (loaded once at module import) ────────────────────────

def load_train_stats(path: Path = TRAIN_STATS_PATH) -> Dict[str, Dict[str, float]]:
    with open(path, "r") as f:
        return json.load(f)


def load_target_stats(path: Path = TARGET_STATS_PATH) -> Dict:
    with open(path, "r") as f:
        return json.load(f)


def build_target_arrays(
    stats: Dict,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Extract mean/std arrays aligned to TARGET_DEPTHS (14 depths, 0 m excluded).

    Returns
    -------
    mean : np.ndarray  [14]
    std  : np.ndarray  [14]
    """
    all_depths = [float(d) for d in stats["depths"]]
    mean_all   = stats["mean"]
    std_all    = stats["std"]

    means, stds = [], []
    for depth in TARGET_DEPTHS:
        idx = all_depths.index(float(depth))
        means.append(float(mean_all[idx]))
        stds.append(float(std_all[idx]))

    return np.array(means, dtype=np.float32), np.array(stds, dtype=np.float32)


# ── grid helpers ──────────────────────────────────────────────────────────────

def lat_to_grid_idx(lat: float) -> int:
    """Nearest grid index for a latitude value."""
    return int(round((lat - GRID_LAT_START) / GRID_RESOLUTION))


def lon_to_grid_idx(lon: float) -> int:
    """Nearest grid index for a longitude value."""
    return int(round((lon - GRID_LON_START) / GRID_RESOLUTION))


def grid_idx_to_lat(idx: int) -> float:
    return GRID_LAT_START + idx * GRID_RESOLUTION


def grid_idx_to_lon(idx: int) -> float:
    return GRID_LON_START + idx * GRID_RESOLUTION


# ── per-variable preprocessing ────────────────────────────────────────────────

def preprocess_sequence(
    raw: np.ndarray,
    train_stats: Dict[str, Dict[str, float]],
) -> np.ndarray:
    """
    Apply training preprocessing to raw surface data.

    Parameters
    ----------
    raw : np.ndarray  [T, 7, H, W]  float32
        Raw physical surface variables in order: sst, sss, sla, uo, vo, wind_u, wind_v

    train_stats : dict
        Training normalization statistics loaded from train_normalization_stats.json

    Returns
    -------
    np.ndarray  [T, 14, H, W]  float32
        14 channels = 7 normalised physical + 7 validity masks
        in the exact channel order used during training
    """
    T, _, H, W = raw.shape
    physical  = np.zeros((T, 7, H, W), dtype=np.float32)
    masks     = np.zeros((T, 7, H, W), dtype=np.float32)

    for c_idx, var in enumerate(SURFACE_VARS):
        x = raw[:, c_idx, :, :]   # [T, H, W]

        # Step 1 — validity mask (finite original values)
        mask = np.where(np.isfinite(x), 1.0, 0.0).astype(np.float32)

        # Step 2 — normalise using TRAINING statistics only
        mean = float(train_stats[var]["mean"])
        std  = float(train_stats[var]["std"])
        x_norm = (x - mean) / std

        # Step 3 — fill NaN with 0 AFTER normalisation
        x_norm = np.where(np.isfinite(x_norm), x_norm, 0.0).astype(np.float32)

        physical[:, c_idx, :, :] = x_norm
        masks[:, c_idx, :, :]    = mask

    # Stack: physical first, masks second  → 14 channels  [T, 14, H, W]
    return np.concatenate([physical, masks], axis=1)


# ── patch extraction / reconstruction ────────────────────────────────────────

def extract_patches(
    x: np.ndarray,
    patch_size: int = PATCH_SIZE,
    stride: int = PATCH_STRIDE,
) -> Tuple[np.ndarray, List[Tuple[int, int]]]:
    """
    Extract spatial patches from a [T, 14, H, W] array.

    Matches the notebook loop:
        for lat in range(0, nlat - patch_size + 1, patch_stride):
            for lon in range(0, nlon - patch_size + 1, patch_stride):

    Returns
    -------
    patches   : np.ndarray  [N_patches, T, 14, patch_size, patch_size]
    positions : list of (lat_start, lon_start)
    """
    T, C, H, W = x.shape
    patches: list = []
    positions: List[Tuple[int, int]] = []

    for lat in range(0, H - patch_size + 1, stride):
        for lon in range(0, W - patch_size + 1, stride):
            patch = x[:, :, lat:lat + patch_size, lon:lon + patch_size]
            patches.append(patch)
            positions.append((lat, lon))

    return np.stack(patches, axis=0), positions   # [N, T, 14, ps, ps]


def reconstruct_from_patches(
    patch_outputs: np.ndarray,
    positions: list,
    patch_size: int,
    H: int,
    W: int,
    C: int,
) -> np.ndarray:
    """
    Reconstruct a spatial [C, H, W] output by averaging overlapping patches.

    patch_outputs : [N, C, patch_size, patch_size]
    """
    canvas  = np.zeros((C, H, W), dtype=np.float32)
    counts  = np.zeros((1, H, W), dtype=np.float32)

    for i, (lat, lon) in enumerate(positions):
        canvas[:, lat:lat + patch_size, lon:lon + patch_size] += patch_outputs[i]
        counts[:, lat:lat + patch_size, lon:lon + patch_size] += 1.0

    # Avoid division by zero for uncovered pixels (edge case if grid isn't a
    # perfect multiple of patch_size)
    counts = np.where(counts == 0, 1.0, counts)
    return canvas / counts   # [C, H, W]


# ── denormalisation ───────────────────────────────────────────────────────────

def denormalize_predictions(
    normalized: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> np.ndarray:
    """
    temperature_C = normalized * target_std + target_mean

    Parameters
    ----------
    normalized  : [14]  model output at a single spatial point
    target_mean : [14]  per-depth mean from target_normalization_stats
    target_std  : [14]  per-depth std  from target_normalization_stats

    Returns
    -------
    np.ndarray [14]  physical temperatures in °C
    """
    return normalized * target_std + target_mean
