"""
Pydantic request / response schemas for the prediction endpoint.
"""

from datetime import date
from typing import List

from pydantic import BaseModel, field_validator, model_validator

from app.core.config import (
    AVAILABLE_YEARS,
    GRID_LAT_START,
    GRID_LON_START,
    GRID_N_LAT,
    GRID_N_LON,
    GRID_RESOLUTION,
    SEQUENCE_LENGTH,
)

# Grid boundaries
_LAT_MIN = GRID_LAT_START
_LAT_MAX = GRID_LAT_START + (GRID_N_LAT - 1) * GRID_RESOLUTION   # 29.875
_LON_MIN = GRID_LON_START
_LON_MAX = GRID_LON_START + (GRID_N_LON - 1) * GRID_RESOLUTION   # 104.875


class PredictionRequest(BaseModel):
    date: date
    latitude: float
    longitude: float

    # ── date validation ───────────────────────────────────────────────────
    @field_validator("date")
    @classmethod
    def date_must_be_in_available_range(cls, v: date) -> date:
        if v.year not in AVAILABLE_YEARS:
            raise ValueError(
                f"Year {v.year} is not available. "
                f"Supported years: {AVAILABLE_YEARS}"
            )
        return v

    # ── coordinate validation ─────────────────────────────────────────────
    @field_validator("latitude")
    @classmethod
    def latitude_in_grid(cls, v: float) -> float:
        if not (_LAT_MIN <= v <= _LAT_MAX):
            raise ValueError(
                f"Latitude {v} is outside the model grid "
                f"[{_LAT_MIN}, {_LAT_MAX}]."
            )
        return v

    @field_validator("longitude")
    @classmethod
    def longitude_in_grid(cls, v: float) -> float:
        if not (_LON_MIN <= v <= _LON_MAX):
            raise ValueError(
                f"Longitude {v} is outside the model grid "
                f"[{_LON_MIN}, {_LON_MAX}]."
            )
        return v

    # ── temporal context validation ───────────────────────────────────────
    @model_validator(mode="after")
    def enough_temporal_context(self) -> "PredictionRequest":
        """
        The model needs SEQUENCE_LENGTH consecutive daily timesteps ending on
        the requested date.  The first usable date in a year is day index
        SEQUENCE_LENGTH-1 (0-based), i.e. the 3rd day of the year for SL=3.
        If the sequence spans year boundaries we check the previous year file
        exists too.
        """
        import datetime

        first_day_of_year = self.date.replace(month=1, day=1)
        day_index = (self.date - first_day_of_year).days  # 0-based

        if day_index < SEQUENCE_LENGTH - 1:
            # Sequence would need data from the previous year
            prev_year = self.date.year - 1
            if prev_year not in AVAILABLE_YEARS:
                raise ValueError(
                    f"Date {self.date} requires {SEQUENCE_LENGTH - 1} prior "
                    f"day(s). Previous year {prev_year} data is not available."
                )
        return self


class PredictionResponse(BaseModel):
    date: str
    latitude: float
    longitude: float
    grid_latitude: float
    grid_longitude: float
    depths_m: List[float]
    temperature_c: List[float]
