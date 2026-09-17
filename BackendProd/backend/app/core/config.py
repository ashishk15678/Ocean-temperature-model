"""
Application configuration.

All paths are relative to the project root (BackendProd/).
Override via environment variables or a .env file.
"""

import os
from pathlib import Path

# ── project root ──────────────────────────────────────────────────────────────
# When the server is started from BackendProd/backend/ the root is one level up.
# When started from BackendProd/ the root is the cwd.
# We resolve relative to this file to be unambiguous.
_FILE_DIR   = Path(__file__).resolve().parent          # …/backend/app/core
_BACKEND    = _FILE_DIR.parent.parent                  # …/backend
PROJECT_ROOT = _BACKEND.parent                         # …/BackendProd


def _path(env_var: str, default: Path) -> Path:
    """Return env override if set, otherwise default."""
    val = os.getenv(env_var)
    if val:
        return Path(val)
    return default


# ── configurable paths ────────────────────────────────────────────────────────
MODEL_PATH: Path = _path(
    "MODEL_PATH",
    PROJECT_ROOT / "models" / "OceanEmbed_best.pth",
)

TRAIN_STATS_PATH: Path = _path(
    "TRAIN_STATS_PATH",
    PROJECT_ROOT / "configs" / "train_normalization_stats(1).json",
)

TARGET_STATS_PATH: Path = _path(
    "TARGET_STATS_PATH",
    PROJECT_ROOT / "configs" / "target_normalization_stats(1).json",
)

SURFACE_DATA_DIR: Path = _path(
    "SURFACE_DATA_DIR",
    PROJECT_ROOT / "data" / "surface",
)

# ── model hyper-parameters (must match training exactly) ─────────────────────
IN_CHANNELS: int    = 14
EMBEDDING_DIM: int  = 64
OUT_CHANNELS: int   = 14

# ── training configuration (must match notebook exactly) ─────────────────────
SEQUENCE_LENGTH: int = 3     # t-2, t-1, t
PATCH_SIZE: int      = 32
PATCH_STRIDE: int    = 32

# ── grid (verified from notebook & surface NetCDF files) ─────────────────────
GRID_N_LAT: int   = 100
GRID_N_LON: int   = 240
GRID_LAT_START: float = 5.125
GRID_LON_START: float = 45.125
GRID_RESOLUTION: float = 0.25   # degrees

# ── surface variable ordering (must match channel stack in notebook) ──────────
SURFACE_VARS: list[str] = ["sst", "sss", "sla", "uo", "vo", "wind_u", "wind_v"]
MASK_VARS: list[str]    = [f"{v}_mask" for v in SURFACE_VARS]

# ── target depths (0 m excluded — no valid GLORYS values there) ───────────────
TARGET_DEPTHS: list[float] = [
    5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000
]

# ── data availability ─────────────────────────────────────────────────────────
AVAILABLE_YEARS: list[int] = [2000, 2001, 2002, 2003, 2004, 2005]
