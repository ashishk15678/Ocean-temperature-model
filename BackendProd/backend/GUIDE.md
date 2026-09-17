# OceanEmbed Backend — Complete Guide

Three sections:

1. [How to start the backend](#1-how-to-start-the-backend)
2. [Postman test collection](#2-postman-test-collection)
3. [How to extend training from 5 years to 20 years](#3-extending-training-to-20-years)

---

## 1. How to start the backend

### Prerequisites

- Python 3.12 already installed via pyenv
- The `.venv` virtual environment at `BackendProd/.venv/` already has all
  dependencies (torch, fastapi, xarray, etc.)
- The following files must exist:
  - `models/OceanEmbed_best.pth`
  - `configs/train_normalization_stats(1).json`
  - `configs/target_normalization_stats(1).json`
  - `data/surface/surface_2000.nc` … `surface_2005.nc`

### Start command

Open a terminal and run these commands **exactly**:

```bash
# Step 1 — go to the backend folder
cd ~/Workspace/SIH/Ocean-temperature-model/BackendProd/backend

# Step 2 — activate the virtual environment
source ../.venv/bin/activate

# Step 3 — start the server
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

You should see output like:

```
INFO | Starting OceanEmbed prediction service…
INFO | Device: cuda
INFO | Constructing OceanEmbedNet(in_channels=14, embedding_dim=64, out_channels=14)
INFO | Loading checkpoint: …/models/OceanEmbed_best.pth
INFO | Checkpoint loaded — epoch=9, train_loss=0.062753, test_loss=0.088400
INFO | Model ready (eval mode).
INFO | Application startup complete.
INFO | Uvicorn running on http://0.0.0.0:8000
```

### Stop the server

Press `Ctrl + C` in the terminal where uvicorn is running.

### Run with auto-reload (development)

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Run tests

```bash
cd ~/Workspace/SIH/Ocean-temperature-model/BackendProd/backend
source ../.venv/bin/activate
python -m pytest tests/ -v
```

Expected: **54 passed**.

---

## 2. Postman test collection

Import the JSON below into Postman:
`File → Import → Raw text → paste the JSON → Import`

```json
{
  "info": {
    "name": "OceanEmbed API",
    "_postman_id": "oceanembed-api-v1",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "base_url",
      "value": "http://localhost:8000",
      "type": "string"
    }
  ],
  "item": [
    {
      "name": "Health Check",
      "request": {
        "method": "GET",
        "url": "{{base_url}}/health"
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status 200', () => pm.response.to.have.status(200));",
              "const b = pm.response.json();",
              "pm.test('status ok',        () => pm.expect(b.status).to.eql('ok'));",
              "pm.test('model_loaded true',() => pm.expect(b.model_loaded).to.be.true);",
              "pm.test('device present',   () => pm.expect(b.device).to.be.a('string'));"
            ]
          }
        }
      ]
    },
    {
      "name": "Predict — 2005-06-15 (Bay of Bengal)",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/v1/predict",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"date\": \"2005-06-15\",\n  \"latitude\": 20.5,\n  \"longitude\": 75.25\n}"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status 200', () => pm.response.to.have.status(200));",
              "const b = pm.response.json();",
              "pm.test('14 depths',      () => pm.expect(b.depths_m).to.have.lengthOf(14));",
              "pm.test('14 temps',       () => pm.expect(b.temperature_c).to.have.lengthOf(14));",
              "pm.test('date echoed',    () => pm.expect(b.date).to.eql('2005-06-15'));",
              "pm.test('lat echoed',     () => pm.expect(b.latitude).to.eql(20.5));",
              "pm.test('lon echoed',     () => pm.expect(b.longitude).to.eql(75.25));",
              "pm.test('grid_lat present', () => pm.expect(b.grid_latitude).to.be.a('number'));",
              "pm.test('grid_lon present', () => pm.expect(b.grid_longitude).to.be.a('number'));",
              "pm.test('temps physical',  () => {",
              "  b.temperature_c.forEach(t => {",
              "    pm.expect(t).to.be.above(-5).and.below(50);",
              "  });",
              "});",
              "pm.test('surface warmer than deep', () => {",
              "  pm.expect(b.temperature_c[0]).to.be.above(b.temperature_c[13]);",
              "});"
            ]
          }
        }
      ]
    },
    {
      "name": "Predict — 2003-08-20 (Arabian Sea)",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/v1/predict",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"date\": \"2003-08-20\",\n  \"latitude\": 15.0,\n  \"longitude\": 60.0\n}"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status 200', () => pm.response.to.have.status(200));",
              "pm.test('14 depths',  () => pm.expect(pm.response.json().depths_m).to.have.lengthOf(14));",
              "pm.test('14 temps',   () => pm.expect(pm.response.json().temperature_c).to.have.lengthOf(14));"
            ]
          }
        }
      ]
    },
    {
      "name": "Predict — 2000-03-10 (earliest year)",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/v1/predict",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"date\": \"2000-03-10\",\n  \"latitude\": 10.0,\n  \"longitude\": 80.0\n}"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status 200', () => pm.response.to.have.status(200));"
            ]
          }
        }
      ]
    },
    {
      "name": "Error — year not available (1990)",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/v1/predict",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"date\": \"1990-06-15\",\n  \"latitude\": 20.5,\n  \"longitude\": 75.25\n}"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status 422', () => pm.response.to.have.status(422));",
              "pm.test('error mentions year', () => {",
              "  pm.expect(pm.response.text()).to.include('1990');",
              "});"
            ]
          }
        }
      ]
    },
    {
      "name": "Error — latitude out of grid (90°N)",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/v1/predict",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"date\": \"2005-06-15\",\n  \"latitude\": 90.0,\n  \"longitude\": 75.25\n}"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status 422', () => pm.response.to.have.status(422));"
            ]
          }
        }
      ]
    },
    {
      "name": "Error — longitude out of grid (200°E)",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/v1/predict",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"date\": \"2005-06-15\",\n  \"latitude\": 20.5,\n  \"longitude\": 200.0\n}"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status 422', () => pm.response.to.have.status(422));"
            ]
          }
        }
      ]
    },
    {
      "name": "Error — bad date format",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/v1/predict",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"date\": \"15/06/2005\",\n  \"latitude\": 20.5,\n  \"longitude\": 75.25\n}"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status 422', () => pm.response.to.have.status(422));"
            ]
          }
        }
      ]
    },
    {
      "name": "Error — missing fields",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/v1/predict",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"date\": \"2005-06-15\"\n}"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status 422', () => pm.response.to.have.status(422));"
            ]
          }
        }
      ]
    },
    {
      "name": "Error — Jan 1 needs previous year (2000-01-01)",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/v1/predict",
        "header": [{ "key": "Content-Type", "value": "application/json" }],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"date\": \"2000-01-01\",\n  \"latitude\": 20.5,\n  \"longitude\": 75.25\n}"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status 422 — no prior year context', () => pm.response.to.have.status(422));"
            ]
          }
        }
      ]
    }
  ]
}
```

### How to run all tests in Postman

1. Import the collection (steps above).
2. Click the collection name **"OceanEmbed API"** in the left sidebar.
3. Click **Run** (top right of collection view).
4. Click **Run OceanEmbed API**.
5. All 10 requests run automatically with assertions.

### Quick curl smoke test (no Postman needed)

```bash
# Health
curl http://localhost:8000/health

# Prediction

curl -X POST http://localhost:8000/api/v1/predict \
  -H "Content-Type: application/json" \
  -d '{"date":"2005-06-15","latitude":20.5,"longitude":75.25}'
```

---

## 3. Extending training to 20 years

The current model is trained on **2000–2004** (5 years) and tested on **2005**.
To extend to 20 years (e.g. 2000–2019 train, 2020–2024 test) you need to go
through three stages:

```
Stage 1 — Download new data
Stage 2 — Preprocess new data (same pipeline as current)
Stage 3 — Retrain the model (same architecture, more data)
```

---

### Stage 1 — Download additional years

The data comes from **Copernicus Marine Service (CMEMS)**.

You need a free account at https://marine.copernicus.eu/

Install the downloader:

```bash
source .venv/bin/activate
pip install copernicusmarine
```

Download each required dataset for each new year.
The datasets used in the original pipeline are:

| Variable | Dataset ID |
|---|---|
| SST | `METOFFICE-GLO-SST-L4-REP-OBS-SST` |
| SSS (salinity) | GLORYS `cmems_mod_glo_phy_my_0.083deg_P1D-m` variable `sos` |
| SLA | `SEALEVEL_GLO_PHY_L4_MY_008_047` |
| Surface currents uo/vo | GLORYS `cmems_mod_glo_phy_my_0.083deg_P1D-m` variables `uo`, `vo` |
| Wind u/v | `WIND_GLO_PHY_L4_MY_012_006` |
| Subsurface thetao (target) | GLORYS `cmems_mod_glo_phy_my_0.083deg_P1D-m` variable `thetao` |

Download parameters (must match the training grid):

```
latitude_min  = 5
latitude_max  = 30
longitude_min = 45
longitude_max = 105
depth_min     = 0       (thetao only)
depth_max     = 1200    (thetao only)
```

Example download command for one variable:

```python
import copernicusmarine

copernicusmarine.subset(
    dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
    variables=["thetao"],
    minimum_latitude=5,
    maximum_latitude=30,
    minimum_longitude=45,
    maximum_longitude=105,
    minimum_depth=0,
    maximum_depth=1200,
    start_datetime="2006-01-01T00:00:00",
    end_datetime="2019-12-31T00:00:00",
    output_filename="GLORYS_thetao_2006_2019.nc",
    output_directory="data/raw/GLORYS/",
)
```

Download all variables for all new years before moving to Stage 2.

---

### Stage 2 — Preprocess new years (same pipeline)

The preprocessing notebook is:
`NoteBooks/TRainingAndProcessingDAta5gbModel.ipynb`

It runs these steps in order for each year:

```
Step 1  GLORYS thetao → vertical interp to 15 depths → spatial interp to 0.25° grid
        → saves processed/target_YYYY.nc

Step 2  surface vars (SST, SSS, SLA, currents, wind) → spatial interp to 0.25° grid
        → saves processed/surface_YYYY.nc

Step 3  temporal alignment → inner join on daily time axis
        → saves processed/aligned_YYYY.nc

Step 4  model-ready: compute masks, normalise with TRAIN-ONLY stats, stack 14 channels
        → saves processed/modelready_YYYY.nc
```

**Critical rule for Step 4:**
The normalization statistics must be recalculated from ALL new training years,
not just the original 2000–2004.

To recalculate stats for a 20-year training set (e.g. 2000–2019):

1. Run notebook cell **"STEP 4 — TRAIN-ONLY NORMALIZATION STATISTICS"** with
   `TRAIN_YEARS = range(2000, 2020)` — this recalculates mean/std over all
   training data.
2. Save the new stats as new JSON files:
   - `configs/train_normalization_stats_20yr.json`
   - `configs/target_normalization_stats_20yr.json`
3. Keep the original 5-year stats files intact — they belong to the deployed model.

---

### Stage 3 — Retrain the model

Open `NoteBooks/Final5YearModel.ipynb` and update the CONFIG cell:

```python
# Change these values
TRAIN_YEARS = list(range(2000, 2020))   # 20 training years
TEST_YEAR   = 2020                      # or whichever year you hold out

# These stay the same — do NOT change
BATCH_SIZE      = 64
PATCH_SIZE      = 32
PATCH_STRIDE    = 32
SEQUENCE_LENGTH = 3
EPOCHS          = 10          # increase to 15-20 for more data
LR              = 3e-4
WEIGHT_DECAY    = 1e-4
```

Also update the stats paths in the dataset class to point to your new
20-year stats files.

Run the notebook. New checkpoints are saved as:
- `OceanEmbed_best.pth`  — best test loss across all epochs
- `OceanEmbed_latest.pth` — last epoch

After training finishes, copy the new best checkpoint:

```bash
cp path/to/new/OceanEmbed_best.pth \
   ~/Workspace/SIH/Ocean-temperature-model/BackendProd/models/OceanEmbed_best.pth
```

And copy the new normalization stats:

```bash
cp path/to/train_normalization_stats_20yr.json \
   ~/Workspace/SIH/Ocean-temperature-model/BackendProd/configs/train_normalization_stats(1).json

cp path/to/target_normalization_stats_20yr.json \
   ~/Workspace/SIH/Ocean-temperature-model/BackendProd/configs/target_normalization_stats(1).json
```

Then also add the new surface files:

```bash
cp path/to/processed/surface_2006.nc \
   ~/Workspace/SIH/Ocean-temperature-model/BackendProd/data/surface/
# repeat for each new year
```

Finally update `config.py` to include the new years:

```python
# backend/app/core/config.py
AVAILABLE_YEARS: list[int] = list(range(2000, 2021))  # 2000–2020
```

Restart the server — it will load the new checkpoint automatically.

---

### Summary checklist for 20-year extension

```
[ ] Download all raw data for 2006–2019 from CMEMS
[ ] Run preprocessing pipeline for each new year
[ ] Recalculate normalization stats over 2000–2019
[ ] Update TRAIN_YEARS in notebook and retrain
[ ] Copy new checkpoint to models/OceanEmbed_best.pth
[ ] Copy new stats to configs/
[ ] Copy new surface_YYYY.nc files to data/surface/
[ ] Update AVAILABLE_YEARS in backend/app/core/config.py
[ ] Restart the backend server
[ ] Run the test suite to verify everything works
```

---

### Important: do NOT change the model architecture

The `OceanEmbedNet` architecture in `backend/app/model/ocean_embed.py` must
stay exactly as-is when using the new checkpoint, because the architecture
is fixed (same number of layers, channels, etc.). The new training just
produces a better-fitted version of the same model.

Only these things change when you extend to 20 years:
- The `.pth` checkpoint file (new weights)
- The normalization stats JSON files (new mean/std)
- The `AVAILABLE_YEARS` list in `config.py`
- The surface NetCDF files in `data/surface/`
