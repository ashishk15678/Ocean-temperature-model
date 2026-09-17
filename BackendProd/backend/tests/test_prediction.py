"""
Tests for:
  - request validation (POST /api/v1/predict)
  - end-to-end integration test using real NetCDF data
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from app.core.config import TARGET_DEPTHS


# ── request validation ────────────────────────────────────────────────────────

class TestRequestValidation:
    def test_invalid_year(self, client):
        r = client.post("/api/v1/predict", json={
            "date": "1990-06-15",
            "latitude": 20.5,
            "longitude": 75.25,
        })
        assert r.status_code == 422   # Pydantic validation

    def test_latitude_out_of_range_high(self, client):
        r = client.post("/api/v1/predict", json={
            "date": "2005-06-15",
            "latitude": 90.0,
            "longitude": 75.25,
        })
        assert r.status_code == 422

    def test_latitude_out_of_range_low(self, client):
        r = client.post("/api/v1/predict", json={
            "date": "2005-06-15",
            "latitude": -10.0,
            "longitude": 75.25,
        })
        assert r.status_code == 422

    def test_longitude_out_of_range(self, client):
        r = client.post("/api/v1/predict", json={
            "date": "2005-06-15",
            "latitude": 20.5,
            "longitude": 200.0,
        })
        assert r.status_code == 422

    def test_bad_date_format(self, client):
        r = client.post("/api/v1/predict", json={
            "date": "15-06-2005",
            "latitude": 20.5,
            "longitude": 75.25,
        })
        assert r.status_code == 422

    def test_missing_fields(self, client):
        r = client.post("/api/v1/predict", json={"date": "2005-06-15"})
        assert r.status_code == 422

    def test_date_with_insufficient_context(self, client):
        """
        Jan 1 2000 is the very first available date.
        For SEQUENCE_LENGTH=3 it needs Jan 1, Jan 2 sequence starting from idx 0,
        but D-2 = Dec 30 1999 which is year 1999 (unavailable).
        Should return 422.
        """
        r = client.post("/api/v1/predict", json={
            "date": "2000-01-01",
            "latitude": 20.5,
            "longitude": 75.25,
        })
        assert r.status_code == 422


# ── end-to-end integration test ───────────────────────────────────────────────

class TestEndToEnd:
    """
    Full pipeline test using real 2005 surface data.
    Exercises: request → NetCDF → preprocessing → model → denorm → response.
    """

    def test_valid_prediction_returns_200(self, client):
        r = client.post("/api/v1/predict", json={
            "date": "2005-06-15",
            "latitude": 20.5,
            "longitude": 75.25,
        })
        assert r.status_code == 200, f"Unexpected error: {r.text}"

    def test_response_contains_14_depths(self, client):
        r = client.post("/api/v1/predict", json={
            "date": "2005-06-15",
            "latitude": 20.5,
            "longitude": 75.25,
        })
        assert r.status_code == 200
        body = r.json()
        assert len(body["depths_m"]) == 14
        assert len(body["temperature_c"]) == 14

    def test_depth_ordering_matches_config(self, client):
        r = client.post("/api/v1/predict", json={
            "date": "2005-06-15",
            "latitude": 20.5,
            "longitude": 75.25,
        })
        assert r.status_code == 200
        assert r.json()["depths_m"] == TARGET_DEPTHS

    def test_temperatures_are_physical(self, client):
        """All predicted temperatures should be within −5 to 50 °C."""
        r = client.post("/api/v1/predict", json={
            "date": "2005-06-15",
            "latitude": 20.5,
            "longitude": 75.25,
        })
        assert r.status_code == 200
        for t in r.json()["temperature_c"]:
            assert -5.0 <= t <= 50.0, f"Temperature {t} outside physical range"

    def test_grid_coords_in_response(self, client):
        r = client.post("/api/v1/predict", json={
            "date": "2005-06-15",
            "latitude": 20.5,
            "longitude": 75.25,
        })
        assert r.status_code == 200
        body = r.json()
        assert "grid_latitude" in body
        assert "grid_longitude" in body

    def test_response_echoes_request_fields(self, client):
        r = client.post("/api/v1/predict", json={
            "date": "2005-06-15",
            "latitude": 20.5,
            "longitude": 75.25,
        })
        assert r.status_code == 200
        body = r.json()
        assert body["date"] == "2005-06-15"
        assert body["latitude"] == 20.5
        assert body["longitude"] == 75.25

    def test_different_valid_date(self, client):
        """Test with a date from a different year."""
        r = client.post("/api/v1/predict", json={
            "date": "2003-08-20",
            "latitude": 15.0,
            "longitude": 60.0,
        })
        assert r.status_code == 200
        assert len(r.json()["temperature_c"]) == 14

    def test_surface_temperatures_warmer_than_deep(self, client):
        """
        Near-surface (5 m) should be warmer than deep (1000 m) in tropical
        Indian Ocean — a basic sanity check.
        """
        r = client.post("/api/v1/predict", json={
            "date": "2005-06-15",
            "latitude": 15.0,
            "longitude": 75.0,
        })
        assert r.status_code == 200
        temps = r.json()["temperature_c"]
        assert temps[0] > temps[-1], \
            f"Surface ({temps[0]:.2f}°C) should be warmer than deep ({temps[-1]:.2f}°C)"
