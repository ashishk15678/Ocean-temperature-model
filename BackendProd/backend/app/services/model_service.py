"""
model_service.py
─────────────────
Loads OceanEmbedNet + checkpoint ONCE at application startup.

Checkpoint selection:
    models/OceanEmbed_best.pth   — epoch 9, test_loss=0.08839  ← SELECTED
    models/OceanEmbed_latest.pth — epoch 10, test_loss=0.08913

The "best" checkpoint has the lower test loss and is the intended
production checkpoint as per the training notebook logic:

    if test_loss < best_test_loss:
        ...save OceanEmbed_best.pth

Exposes:
    ModelService.model   — loaded, eval-mode OceanEmbedNet
    ModelService.device  — torch.device used for inference
    ModelService.loaded  — bool
"""

import logging
from pathlib import Path
from typing import Optional

import torch

from app.core.config import (
    EMBEDDING_DIM,
    IN_CHANNELS,
    MODEL_PATH,
    OUT_CHANNELS,
)
from app.model.ocean_embed import OceanEmbedNet

logger = logging.getLogger(__name__)


class ModelService:
    """Singleton-style service holding the loaded model."""

    model: Optional[OceanEmbedNet] = None
    device: Optional[torch.device] = None
    loaded: bool = False

    @classmethod
    def startup(cls, model_path: Path = MODEL_PATH) -> None:
        """
        Called once during FastAPI lifespan startup.

        1. Determine device (CUDA if available, otherwise CPU).
        2. Construct exact OceanEmbedNet.
        3. Load checkpoint state_dict.
        4. Call model.eval().
        """
        logger.info("=== ModelService startup ===")

        # ── device ────────────────────────────────────────────────────────
        cls.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"Device: {cls.device}")

        # ── architecture ──────────────────────────────────────────────────
        logger.info(
            f"Constructing OceanEmbedNet(in_channels={IN_CHANNELS}, "
            f"embedding_dim={EMBEDDING_DIM}, out_channels={OUT_CHANNELS})"
        )
        cls.model = OceanEmbedNet(
            in_channels=IN_CHANNELS,
            embedding_dim=EMBEDDING_DIM,
            out_channels=OUT_CHANNELS,
        ).to(cls.device)

        # ── checkpoint ────────────────────────────────────────────────────
        checkpoint_path = Path(model_path)
        if not checkpoint_path.exists():
            raise RuntimeError(
                f"Checkpoint not found: {checkpoint_path}. "
                "Cannot start the application without the model."
            )

        logger.info(f"Loading checkpoint: {checkpoint_path}")
        checkpoint = torch.load(
            str(checkpoint_path),
            map_location=cls.device,
            weights_only=False,
        )

        # Validate checkpoint format
        if "model_state_dict" not in checkpoint:
            raise RuntimeError(
                f"Checkpoint {checkpoint_path} does not contain "
                "'model_state_dict'. Keys found: "
                f"{list(checkpoint.keys())}"
            )

        cls.model.load_state_dict(checkpoint["model_state_dict"])

        epoch      = checkpoint.get("epoch", "?")
        train_loss = checkpoint.get("train_loss", float("nan"))
        test_loss  = checkpoint.get("test_loss", float("nan"))
        logger.info(
            f"Checkpoint loaded — epoch={epoch}, "
            f"train_loss={train_loss:.6f}, test_loss={test_loss:.6f}"
        )

        # ── eval mode ─────────────────────────────────────────────────────
        cls.model.eval()
        cls.loaded = True
        logger.info("Model ready (eval mode).")

    @classmethod
    def infer(cls, x: torch.Tensor) -> torch.Tensor:
        """
        Run inference with torch.inference_mode().

        Parameters
        ----------
        x : torch.Tensor  [B, T, 14, H, W]

        Returns
        -------
        torch.Tensor  [B, 14, H, W]
        """
        if not cls.loaded or cls.model is None:
            raise RuntimeError("Model is not loaded. Call ModelService.startup() first.")

        x = x.to(cls.device)
        with torch.inference_mode():
            return cls.model(x)

    @classmethod
    def device_name(cls) -> str:
        if cls.device is None:
            return "unknown"
        return str(cls.device)
