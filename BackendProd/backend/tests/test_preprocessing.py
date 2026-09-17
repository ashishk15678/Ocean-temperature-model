"""
Unit tests for:
  - date-to-file selection
  - surface variable loading
  - mask creation
  - normalization
  - model input shape
  - target denormalization
  - latitude/longitude grid mapping
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import date, timedelta

import numpy as np
import pytest

from app.core.config import (
    GRID_LAT_START,
    GRID_LON_START,
    GRID_N_LAT,
    GRID_N_LON,
    GRID_RESOLUTION,
    PATCH_SIZE,
    PATCH_STRIDE,
    SEQUENCE_LENGTH,
    SURFACE_VARS,
    TARGET_DEPTHS,
    TARGET_STATS_PATH,
    TRAIN_STATS_PATH,
)
from app.services.data_service import (
    build_date_sequence,
    get_surface_file,
    load_surface_sequence,
    surface_file_exists,
)
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


# ── date-to-file selection ────────────────────────────────────────────────────

class TestDateToFile:
    def test_correct_filename(self):
        p = get_surface_file(2005)
        assert p.name == "surface_2005.nc"

    def test_file_exists_for_all_years(self):
        for year in [2000, 2001, 2002, 2003, 2004, 2005]:
            assert surface_file_exists(year), f"surface_{year}.nc missing"

    def test_nonexistent_year(self):
        assert not surface_file_exists(1999)


# ── date sequence construction ────────────────────────────────────────────────

class TestDateSequence:
    def test_length(self):
        seq = build_date_sequence(date(2005, 6, 15), SEQUENCE_LENGTH)
        assert len(seq) == SEQUENCE_LENGTH

    def test_last_element_is_target_date(self):
        d = date(2005, 6, 15)
        seq = build_date_sequence(d, SEQUENCE_LENGTH)
        assert seq[-1] == d

    def test_sequence_is_consecutive(self):
        d = date(2005, 6, 15)
        seq = build_date_sequence(d, SEQUENCE_LENGTH)
        for i in range(1, len(seq)):
            assert (seq[i] - seq[i - 1]).days == 1

    def test_sequence_d2_d1_d(self):
        """For SL=3 the sequence should be D-2, D-1, D."""
        d = date(2005, 6, 15)
        seq = build_date_sequence(d, 3)
        assert seq[0] == date(2005, 6, 13)
        assert seq[1] == date(2005, 6, 14)
        assert seq[2] == date(2005, 6, 15)


# ── surface variable loading ──────────────────────────────────────────────────

class TestSurfaceLoading:
    def test_shape(self):
        dates = build_date_sequence(date(2005, 6, 15), SEQUENCE_LENGTH)
        raw = load_surface_sequence(dates)
        assert raw.shape == (SEQUENCE_LENGTH, len(SURFACE_VARS), GRID_N_LAT, GRID_N_LON)

    def test_dtype_float32(self):
        dates = build_date_sequence(date(2005, 6, 15), SEQUENCE_LENGTH)
        raw = load_surface_sequence(dates)
        assert raw.dtype == np.float32

    def test_all_7_channels_present(self):
        dates = build_date_sequence(date(2005, 6, 15), SEQUENCE_LENGTH)
        raw = load_surface_sequence(dates)
        assert raw.shape[1] == 7


# ── mask creation ─────────────────────────────────────────────────────────────

class TestMaskCreation:
    def _make_raw(self):
        dates = build_date_sequence(date(2005, 6, 15), SEQUENCE_LENGTH)
        return load_surface_sequence(dates)

    def test_mask_values_are_0_or_1(self):
        raw = self._make_raw()
        train_stats = load_train_stats()
        processed = preprocess_sequence(raw, train_stats)
        # mask channels are the last 7
        masks = processed[:, 7:, :, :]
        unique = np.unique(masks)
        for v in unique:
            assert v in (0.0, 1.0), f"Unexpected mask value: {v}"

    def test_mask_matches_finite_values(self):
        raw = self._make_raw()
        train_stats = load_train_stats()
        processed = preprocess_sequence(raw, train_stats)
        # For channel 0 (sst): mask should equal isfinite(raw sst)
        expected_mask = np.where(np.isfinite(raw[:, 0, :, :]), 1.0, 0.0)
        np.testing.assert_array_equal(processed[:, 7, :, :], expected_mask)


# ── normalization ─────────────────────────────────────────────────────────────

class TestNormalization:
    def test_no_nans_in_processed_physical(self):
        dates = build_date_sequence(date(2005, 6, 15), SEQUENCE_LENGTH)
        raw = load_surface_sequence(dates)
        train_stats = load_train_stats()
        processed = preprocess_sequence(raw, train_stats)
        # Physical channels (first 7) must have no NaN
        assert not np.any(np.isnan(processed[:, :7, :, :]))

    def test_invalid_values_set_to_zero(self):
        """
        Wherever raw data had NaN, the processed physical channel must be 0.
        """
        dates = build_date_sequence(date(2005, 6, 15), SEQUENCE_LENGTH)
        raw = load_surface_sequence(dates)
        train_stats = load_train_stats()
        processed = preprocess_sequence(raw, train_stats)
        for c in range(7):
            invalid = ~np.isfinite(raw[:, c, :, :])
            assert np.all(processed[:, c, :, :][invalid] == 0.0), \
                f"Channel {c}: invalid positions are not 0"

    def test_channel_count_is_14(self):
        dates = build_date_sequence(date(2005, 6, 15), SEQUENCE_LENGTH)
        raw = load_surface_sequence(dates)
        train_stats = load_train_stats()
        processed = preprocess_sequence(raw, train_stats)
        assert processed.shape[1] == 14


# ── model input shape ─────────────────────────────────────────────────────────

class TestModelInputShape:
    def test_patch_shape(self):
        dates = build_date_sequence(date(2005, 6, 15), SEQUENCE_LENGTH)
        raw = load_surface_sequence(dates)
        train_stats = load_train_stats()
        processed = preprocess_sequence(raw, train_stats)
        patches, positions = extract_patches(processed, PATCH_SIZE, PATCH_STRIDE)
        N, T, C, H, W = patches.shape
        assert T == SEQUENCE_LENGTH
        assert C == 14
        assert H == PATCH_SIZE
        assert W == PATCH_SIZE

    def test_patch_count(self):
        """100 lat / 32 stride = 3 patches (0,32,64), 240 lon / 32 = 7 → 21 total."""
        dates = build_date_sequence(date(2005, 6, 15), SEQUENCE_LENGTH)
        raw = load_surface_sequence(dates)
        train_stats = load_train_stats()
        processed = preprocess_sequence(raw, train_stats)
        patches, positions = extract_patches(processed, PATCH_SIZE, PATCH_STRIDE)
        n_lat = len(range(0, GRID_N_LAT - PATCH_SIZE + 1, PATCH_STRIDE))
        n_lon = len(range(0, GRID_N_LON - PATCH_SIZE + 1, PATCH_STRIDE))
        assert patches.shape[0] == n_lat * n_lon


# ── target denormalization ────────────────────────────────────────────────────

class TestDenormalization:
    def test_zero_norm_gives_mean(self):
        target_stats = load_target_stats()
        mean, std = build_target_arrays(target_stats)
        normalized = np.zeros(14, dtype=np.float32)
        result = denormalize_predictions(normalized, mean, std)
        np.testing.assert_allclose(result, mean, rtol=1e-5)

    def test_output_length(self):
        target_stats = load_target_stats()
        mean, std = build_target_arrays(target_stats)
        normalized = np.ones(14, dtype=np.float32)
        result = denormalize_predictions(normalized, mean, std)
        assert len(result) == 14

    def test_temperatures_are_physical(self):
        """Denormalized temps for tropical Indian Ocean should be in [0, 40] °C."""
        target_stats = load_target_stats()
        mean, std = build_target_arrays(target_stats)
        normalized = np.zeros(14, dtype=np.float32)
        result = denormalize_predictions(normalized, mean, std)
        assert np.all(result > 0) and np.all(result < 50)

    def test_depth_count(self):
        target_stats = load_target_stats()
        mean, std = build_target_arrays(target_stats)
        assert len(mean) == 14
        assert len(std) == 14


# ── lat/lon grid mapping ──────────────────────────────────────────────────────

class TestGridMapping:
    def test_exact_grid_point(self):
        # 5.125 is the first grid point
        idx = lat_to_grid_idx(GRID_LAT_START)
        assert idx == 0

    def test_last_grid_point(self):
        last_lat = GRID_LAT_START + (GRID_N_LAT - 1) * GRID_RESOLUTION
        idx = lat_to_grid_idx(last_lat)
        assert idx == GRID_N_LAT - 1

    def test_nearest_selection(self):
        # 20.5 should map to nearest: (20.5 - 5.125)/0.25 = 61.5 → 62
        idx = lat_to_grid_idx(20.5)
        assert idx == 62

    def test_roundtrip_lat(self):
        for lat in [5.125, 15.375, 29.875]:
            idx = lat_to_grid_idx(lat)
            recovered = grid_idx_to_lat(idx)
            assert abs(recovered - lat) < 1e-6

    def test_roundtrip_lon(self):
        for lon in [45.125, 75.125, 104.875]:
            idx = lon_to_grid_idx(lon)
            recovered = grid_idx_to_lon(idx)
            assert abs(recovered - lon) < 1e-6
