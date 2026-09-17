"""
prediction_service.py
──────────────────────
Orchestrates the full inference pipeline:

    request (date, lat, lon)
        ↓
    build date sequence [D-2, D-1, D]
        ↓
    load raw surface data  [T, 7, 100, 240]
        ↓
    preprocess (mask + normalize)  [T, 14, 100, 240]
        ↓
    extract patches  [N, T, 14, 32, 32]
        ↓
    run OceanEmbedNet inference  [N, 14, 32, 32]
        ↓
    reconstruct spatial output  [14, 100, 240]  (or padded equivalent)
        ↓
    extract prediction at requested grid cell  [14]
        ↓
    denormalize  [14] temperatures in °C
        ↓
    return PredictionResponse
"""

import json
import logging
from datetime import date
from pathlib import Path

import numpy as np
import torch

from app.core.config import (
    GRID_N_LAT,
    GRID_N_LON,
    OUT_CHANNELS,
    PATCH_SIZE,
    PATCH_STRIDE,
    SEQUENCE_LENGTH,
    SURFACE_DATA_DIR,
    TARGET_DEPTHS,
    TARGET_STATS_PATH,
    TRAIN_STATS_PATH,
)
from app.schemas.prediction import PredictionResponse
from app.services.data_service import build_date_sequence, load_surface_sequence
from app.services.model_service import ModelService
from app.services.preprocessing import (
    build_target_arrays,
    denormalize_predictions,
    extract_patches,
    grid_idx_to_lat,
    grid_idx_to_lon,
    lat_to_grid_idx,
    load_target_stats,
    load_train_stats,
    lon_to_grid_idx,
    preprocess_sequence,
    reconstruct_from_patches,
)

logger = logging.getLogger(__name__)

# ── load stats once at module import ─────────────────────────────────────────
_train_stats  = load_train_stats(TRAIN_STATS_PATH)
_target_stats = load_target_stats(TARGET_STATS_PATH)
_target_mean, _target_std = build_target_arrays(_target_stats)


def predict(req_date: date, latitude: float, longitude: float) -> PredictionResponse:
    """
    Full inference pipeline.

    Parameters
    ----------
    req_date  : requested date
    latitude  : requested latitude (decimal degrees)
    longitude : requested longitude (decimal degrees)

    Returns
    -------
    PredictionResponse
    """
    logger.info(f"Predict request: date={req_date}, lat={latitude}, lon={longitude}")

    # ── 1. map coordinate to nearest grid cell ────────────────────────────
    lat_idx = lat_to_grid_idx(latitude)
    lon_idx = lon_to_grid_idx(longitude)

    # Clamp to valid grid indices
    lat_idx = max(0, min(lat_idx, GRID_N_LAT - 1))
    lon_idx = max(0, min(lon_idx, GRID_N_LON - 1))

    grid_lat = grid_idx_to_lat(lat_idx)
    grid_lon = grid_idx_to_lon(lon_idx)
    logger.info(f"Nearest grid cell: lat_idx={lat_idx}, lon_idx={lon_idx} "
                f"→ ({grid_lat:.3f}, {grid_lon:.3f})")

    # ── 2. build date sequence  [D-2, D-1, D] ────────────────────────────
    dates = build_date_sequence(req_date, SEQUENCE_LENGTH)
    logger.info(f"Date sequence: {[str(d) for d in dates]}")

    # ── 3. load raw surface data  [T, 7, 100, 240] ───────────────────────
    raw = load_surface_sequence(dates, data_dir=Path(SURFACE_DATA_DIR))
    logger.info(f"Raw surface data shape: {raw.shape}")

    # ── 4. preprocess  → [T, 14, 100, 240] ───────────────────────────────
    processed = preprocess_sequence(raw, _train_stats)
    logger.info(f"Preprocessed shape: {processed.shape}")

    # ── 5. extract patches ────────────────────────────────────────────────
    patches, positions = extract_patches(
        processed, patch_size=PATCH_SIZE, stride=PATCH_STRIDE
    )
    # patches: [N, T, 14, 32, 32]
    logger.info(f"Patches: {patches.shape},  positions: {len(positions)}")

    # ── 6. run inference (batch all patches) ─────────────────────────────
    x_tensor = torch.from_numpy(patches)   # [N, T, 14, 32, 32]
    output_tensor = ModelService.infer(x_tensor)   # [N, 14, 32, 32]
    patch_outputs = output_tensor.cpu().numpy()    # [N, 14, 32, 32]
    logger.info(f"Inference output shape: {patch_outputs.shape}")

    # ── 7. reconstruct full spatial output  [14, H, W] ───────────────────
    spatial_output = reconstruct_from_patches(
        patch_outputs,
        positions,
        patch_size=PATCH_SIZE,
        H=GRID_N_LAT,
        W=GRID_N_LON,
        C=OUT_CHANNELS,
    )
    logger.info(f"Reconstructed spatial output shape: {spatial_output.shape}")

    # ── 8. extract at requested grid cell  [14] ───────────────────────────
    pred_normalized = spatial_output[:, lat_idx, lon_idx]   # [14]
    logger.info(f"Normalised prediction at grid cell: {pred_normalized}")

    # ── 9. denormalize  → physical °C ────────────────────────────────────
    temperatures = denormalize_predictions(
        pred_normalized, _target_mean, _target_std
    )
    logger.info(f"Denormalized temperatures: {temperatures}")

    return PredictionResponse(
        date=str(req_date),
        latitude=latitude,
        longitude=longitude,
        grid_latitude=round(grid_lat, 3),
        grid_longitude=round(grid_lon, 3),
        depths_m=TARGET_DEPTHS,
        temperature_c=[round(float(t), 4) for t in temperatures],
    )
