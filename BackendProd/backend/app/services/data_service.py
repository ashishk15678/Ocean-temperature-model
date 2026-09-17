"""
data_service.py
───────────────
Handles all NetCDF I/O.

Responsibilities:
  • Map a date to the correct surface_YYYY.nc file.
  • Load 7 raw surface variables for a sequence of dates.
  • Validate that required variables and dates exist.
  • Never load all years into memory.
  • Never touch thetao (target variable — not used for inference).
"""

import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, List

import numpy as np
import xarray as xr

from app.core.config import SURFACE_DATA_DIR, SURFACE_VARS

logger = logging.getLogger(__name__)


def get_surface_file(year: int, data_dir: Path = SURFACE_DATA_DIR) -> Path:
    """Return path to surface_YYYY.nc for the given year."""
    path = Path(data_dir) / f"surface_{year}.nc"
    return path


def surface_file_exists(year: int, data_dir: Path = SURFACE_DATA_DIR) -> bool:
    return get_surface_file(year, data_dir).exists()


def build_date_sequence(target_date: date, sequence_length: int) -> List[date]:
    """
    Build the list of dates required for the model sequence.
    Sequence: [D-(sl-1), ..., D-1, D]  (ends on target_date).

    Matches the notebook dataset construction:
        X = self.X[t-sl+1 : t+1, ...]
    """
    return [target_date - timedelta(days=i) for i in reversed(range(sequence_length))]


def load_surface_sequence(
    dates: List[date],
    data_dir: Path = SURFACE_DATA_DIR,
) -> np.ndarray:
    """
    Load the 7 raw surface variables for each date in the sequence.

    Returns
    -------
    np.ndarray  shape [T, 7, 100, 240]  float32
        T = len(dates)
        7 channels: sst, sss, sla, uo, vo, wind_u, wind_v (in this order)
    """
    # Group dates by year to avoid opening the same file multiple times
    years_needed = sorted({d.year for d in dates})

    # Validate files exist before loading
    for year in years_needed:
        fp = get_surface_file(year, data_dir)
        if not fp.exists():
            raise FileNotFoundError(
                f"Surface data file not found: {fp}. "
                f"Year {year} data is required but missing."
            )

    # Open datasets (one per year)
    datasets: Dict[int, xr.Dataset] = {}
    try:
        for year in years_needed:
            fp = get_surface_file(year, data_dir)
            logger.info(f"Opening surface file: {fp}")
            datasets[year] = xr.open_dataset(str(fp), engine="netcdf4")
            _validate_variables(datasets[year], year)

        frames = []
        for d in dates:
            ds = datasets[d.year]

            # Select the single time step — xr.sel with method="nearest"
            # tolerates minor floating-point differences in time encoding
            day_data = ds.sel(time=str(d), method="nearest")

            # Stack variables in the exact training channel order
            channels = np.stack(
                [day_data[v].values.astype(np.float32) for v in SURFACE_VARS],
                axis=0,
            )  # [7, 100, 240]
            frames.append(channels)

    finally:
        for ds in datasets.values():
            ds.close()

    return np.stack(frames, axis=0)   # [T, 7, 100, 240]


def _validate_variables(ds: xr.Dataset, year: int) -> None:
    missing = [v for v in SURFACE_VARS if v not in ds.data_vars]
    if missing:
        raise ValueError(
            f"surface_{year}.nc is missing required variables: {missing}. "
            f"Found: {list(ds.data_vars)}"
        )
