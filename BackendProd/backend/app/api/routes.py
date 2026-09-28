"""
API routes.

GET  /health              → service health check
GET  /api/v1/model-info   → static model metadata (architecture, grid, depths, vars)
POST /api/v1/predict      → subsurface temperature prediction
"""

import logging
from datetime import date as _date

from fastapi import APIRouter, HTTPException

from app.schemas.prediction import PredictionRequest, PredictionResponse
from app.services.model_service import ModelService
from app.services.prediction_service import predict
from app.core.config import (
    IN_CHANNELS, EMBEDDING_DIM, OUT_CHANNELS,
    SEQUENCE_LENGTH, PATCH_SIZE, PATCH_STRIDE,
    GRID_N_LAT, GRID_N_LON, GRID_LAT_START, GRID_LON_START, GRID_RESOLUTION,
    SURFACE_VARS, MASK_VARS, TARGET_DEPTHS, AVAILABLE_YEARS,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ── /health ───────────────────────────────────────────────────────────────────

@router.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": ModelService.loaded,
        "device": ModelService.device_name(),
    }


# ── /api/v1/model-info ────────────────────────────────────────────────────────

@router.get("/api/v1/model-info")
def model_info():
    """
    Returns all static model and grid metadata — never changes at runtime.
    Safe to cache indefinitely on the frontend.
    """
    lat_max = round(GRID_LAT_START + (GRID_N_LAT - 1) * GRID_RESOLUTION, 3)
    lon_max = round(GRID_LON_START + (GRID_N_LON - 1) * GRID_RESOLUTION, 3)

    return {
        "model": {
            "name": "OceanEmbedNet",
            "version": "1.0.0",
            "checkpoint": "OceanEmbed_best.pth",
            "in_channels": IN_CHANNELS,
            "embedding_dim": EMBEDDING_DIM,
            "out_channels": OUT_CHANNELS,
            "sequence_length": SEQUENCE_LENGTH,
            "patch_size": PATCH_SIZE,
            "patch_stride": PATCH_STRIDE,
            "loaded": ModelService.loaded,
            "device": ModelService.device_name(),
        },
        "grid": {
            "n_lat": GRID_N_LAT,
            "n_lon": GRID_N_LON,
            "lat_start": GRID_LAT_START,
            "lon_start": GRID_LON_START,
            "lat_end": lat_max,
            "lon_end": lon_max,
            "resolution_deg": GRID_RESOLUTION,
            "total_cells": GRID_N_LAT * GRID_N_LON,
        },
        "surface_variables": SURFACE_VARS,
        "mask_variables": MASK_VARS,
        "all_channels": SURFACE_VARS + MASK_VARS,
        "target_depths_m": TARGET_DEPTHS,
        "n_target_depths": len(TARGET_DEPTHS),
        "available_years": AVAILABLE_YEARS,
        "focus_regions": [
            {"name": "Arabian Sea",    "lat": 17.0, "lon": 65.0},
            {"name": "Bay of Bengal",  "lat": 14.0, "lon": 88.0},
            {"name": "Indian Ocean",   "lat":  5.5, "lon": 75.0},
        ],
    }


# ── /api/v1/predict ───────────────────────────────────────────────────────────

@router.post("/api/v1/predict", response_model=PredictionResponse)
def predict_endpoint(req: PredictionRequest):
    """
    Predict subsurface ocean temperature at depth.

    Request body:
        {
            "date":      "YYYY-MM-DD",
            "latitude":  float,
            "longitude": float
        }
    """
    if not ModelService.loaded:
        raise HTTPException(status_code=503, detail="Model not loaded.")

    try:
        return predict(req.date, req.latitude, req.longitude)

    except FileNotFoundError as exc:
        logger.warning(f"Data not found: {exc}")
        raise HTTPException(status_code=404, detail=str(exc))

    except ValueError as exc:
        logger.warning(f"Validation error: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))

    except Exception as exc:
        logger.exception(f"Inference error: {exc}")
        raise HTTPException(
            status_code=500,
            detail="Internal inference error. See server logs for details.",
        )
