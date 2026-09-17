"""
API routes.

GET  /health         → service health check
POST /api/v1/predict → subsurface temperature prediction
"""

import logging
from datetime import date as _date

from fastapi import APIRouter, HTTPException

from app.schemas.prediction import PredictionRequest, PredictionResponse
from app.services.model_service import ModelService
from app.services.prediction_service import predict

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
