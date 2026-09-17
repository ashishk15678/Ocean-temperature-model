"""
Shared pytest fixtures.
"""

import sys
from pathlib import Path

# Ensure 'app' is importable when pytest is run from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.model_service import ModelService


@pytest.fixture(scope="session", autouse=True)
def load_model():
    """Load the model once for the entire test session."""
    if not ModelService.loaded:
        ModelService.startup()


@pytest.fixture(scope="session")
def client(load_model):
    with TestClient(app) as c:
        yield c
