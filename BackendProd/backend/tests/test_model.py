"""
Tests for:
  - model checkpoint loading
  - model architecture / forward pass shape
  - prediction output shape
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pytest
import torch

from app.core.config import (
    EMBEDDING_DIM,
    IN_CHANNELS,
    MODEL_PATH,
    OUT_CHANNELS,
    PATCH_SIZE,
    SEQUENCE_LENGTH,
)
from app.model.ocean_embed import OceanEmbedNet
from app.services.model_service import ModelService


class TestCheckpointLoading:
    def test_model_is_loaded(self):
        assert ModelService.loaded is True

    def test_model_instance(self):
        assert isinstance(ModelService.model, OceanEmbedNet)

    def test_checkpoint_file_exists(self):
        assert Path(MODEL_PATH).exists()

    def test_state_dict_keys_match(self):
        """Verify every checkpoint key exists in the live model."""
        ck = torch.load(str(MODEL_PATH), map_location="cpu", weights_only=False)
        ck_keys = set(ck["model_state_dict"].keys())
        model_keys = set(ModelService.model.state_dict().keys())
        assert ck_keys == model_keys, \
            f"Key mismatch. Extra in ckpt: {ck_keys - model_keys}, " \
            f"missing from ckpt: {model_keys - ck_keys}"

    def test_model_in_eval_mode(self):
        assert not ModelService.model.training


class TestModelForward:
    def _make_input(self, B=1, T=SEQUENCE_LENGTH, C=IN_CHANNELS, H=PATCH_SIZE, W=PATCH_SIZE):
        return torch.randn(B, T, C, H, W)

    def test_output_shape(self):
        x = self._make_input()
        out = ModelService.infer(x)
        assert out.shape == (1, OUT_CHANNELS, PATCH_SIZE, PATCH_SIZE)

    def test_batch_output_shape(self):
        x = self._make_input(B=4)
        out = ModelService.infer(x)
        assert out.shape == (4, OUT_CHANNELS, PATCH_SIZE, PATCH_SIZE)

    def test_output_is_finite(self):
        x = self._make_input()
        out = ModelService.infer(x)
        assert torch.isfinite(out).all(), "Model output contains NaN or Inf"

    def test_inference_mode_no_grad(self):
        """Output should not require gradients (inference_mode)."""
        x = self._make_input()
        out = ModelService.infer(x)
        assert not out.requires_grad

    def test_model_is_deterministic_in_eval(self):
        """Same input should produce same output in eval mode."""
        x = self._make_input(B=1)
        out1 = ModelService.infer(x)
        out2 = ModelService.infer(x)
        assert torch.allclose(out1, out2, atol=1e-6)

    def test_14_channel_output(self):
        x = self._make_input()
        out = ModelService.infer(x)
        assert out.shape[1] == 14   # 14 depth channels
