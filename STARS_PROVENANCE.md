# STARS source provenance and adaptation notes

## Upstream model

This repository visualises the **STARS treatment-centre model** distributed as the Python package `treat-sim`.

The browser implementation is pinned to:

- project: `pythonhealthdatascience/stars-treat-sim`
- release: `v3.0.0`
- package: `treat-sim==3.0.0`
- source commit: `e4a8c548d9ff7b36baa4fa117c492b66adcd78fa`
- release date: 11 February 2026
- licence: MIT

PyPI provenance for `treat-sim==3.0.0` identifies the same GitHub commit and tag.

The maintained STARS Streamlit application (`pythonhealthdatascience/stars-streamlit-example`) also depends on `treat-sim==3.0.0` in its current requirements. Its changelog records earlier corrections to the trauma treatment distribution/pathway and its current upgrade to version 3.0.0.

## Model represented

The model is a terminating treatment-centre discrete-event simulation adapted from Nelson (2013). Patients arrive according to a non-stationary Poisson process and are triaged to one of two pathways.

**Trauma:**

1. Triage
2. Trauma stabilisation
3. Trauma treatment cubicle
4. Discharge

**Non-trauma:**

1. Triage
2. Registration
3. Examination
4. Optional non-trauma treatment cubicle
5. Discharge

The published baseline resource capacities are:

- triage: 1
- registration: 1
- examination: 3
- trauma stabilisation: 2
- non-trauma treatment cubicles: 1
- trauma treatment cubicles: 1

The default results-collection period is 1,140 minutes. The default arrival profile contains 18 hourly arrival rates from 06:00 to midnight.

## Browser architecture

```text
Published treat-sim 3.0.0
        ↓
Pyodide / CPython in browser
        ↓
TreatmentCentreModel (SimPy)
        ↓
patient records + SimulationSummary
        ↓
stars_bridge.py
        ↓
JSON event trace
        ↓
Three.js visual-state engine
        ↓
Desktop 3D / WebXR
```

The browser installs the published package. `stars_bridge.py` does **not** reimplement the DES process logic. It instantiates the upstream `Scenario` and `TreatmentCentreModel`, runs the model, and transforms its patient records into animation events.

## Adaptations made for visualisation

### Event reconstruction

The upstream model records arrival, waits, activity durations and total time by patient. The bridge reconstructs the corresponding absolute event times from those records and emits:

- `arrival`
- `enter_queue`
- `request_resource`
- `start_service`
- `end_service`
- `move_to_next_stage`
- `departure`

No visual event changes a SimPy timing.

### Resource unit identifiers

`simpy.Resource` represents pooled capacity and does not name individual identical physical units. For visualisation only, the bridge assigns a deterministic unit number to each completed/started service interval. The assignment is constrained so intervals allocated to the same visual unit do not overlap. This affects only presentation; it does not alter queueing, service start times, service durations or outcomes.

### Demand multiplier

The interface exposes a demand multiplier by multiplying every hourly arrival rate in the published Nelson arrival profile by the same factor before it is passed into the upstream `Scenario`. A value of `1.0` is the STARS baseline.

### Three.js environment

The spatial treatment-centre layout is an educational representation of the logical process, not a claim that the Nelson/STARS model describes a particular real building. Architecture, walking paths, furniture, signs and interpolated motion are presentation elements only.

## Package/runtime pins

The browser currently loads:

- Pyodide 0.29.5
- `treat-sim==3.0.0`
- `simpy==4.1.1`
- `sim-tools==1.3.0`
- Three.js 0.186.0

NumPy, pandas and SciPy are loaded from the Pyodide distribution before the pure-Python STARS packages are installed.

## Attribution

`treat-sim` is authored by Thomas Monks, Alison Harper and Amy Heather and is released under the MIT licence. The STARS materials request citation of the project and the associated work on reusable healthcare simulations.

This WebXR adaptation is an independent demonstrator. It is **not an official STARS product** and is not endorsed by the STARS authors.

## Limitations

- The 3D building is schematic and not a clinically validated layout.
- Walking time is visually interpolated and is not an additional DES activity.
- Named visual unit IDs are derived presentation metadata because upstream `simpy.Resource` objects model pooled capacity.
- The application visualises one stochastic replication at a time; it is not a replacement for multi-replication analysis.
- The browser must download Pyodide and Python packages on first load, so first-run startup is slower than later runs.
