"""
main.py
────────
FastAPI application entry point.

Startup sequence (lifespan):
    1. Load configuration  (already done at import via config.py)
    2. Load normalization statistics  (done at preprocessing.py import)
    3. Determine device
    4. Construct OceanEmbedNet
    5. Load OceanEmbed_best.pth checkpoint
    6. model.eval()
    7. Model available for all requests via ModelService
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.services.model_service import ModelService

# ── logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


# ── lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the model once at startup, release at shutdown."""
    logger.info("Starting OceanEmbed prediction service…")
    ModelService.startup()
    logger.info("OceanEmbed prediction service ready.")
    yield
    logger.info("Shutting down OceanEmbed prediction service.")


# ── app ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="OceanEmbed Prediction API",
    description=(
        "Subsurface ocean temperature prediction using OceanEmbedNet. "
        "Accepts date + latitude + longitude; returns 14-depth temperature profile."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(router)
