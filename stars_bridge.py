"""Browser bridge for STARS treat-sim 3.0.0.

The DES itself is the published `treat-sim==3.0.0` package. This module does
not replace its process logic. It runs TreatmentCentreModel and transforms the
resulting patient records into a JSON event trace suitable for Three.js/WebXR.

Upstream source pinned for this adaptation:
https://github.com/pythonhealthdatascience/stars-treat-sim/tree/e4a8c548d9ff7b36baa4fa117c492b66adcd78fa
"""
from __future__ import annotations

import json
import math
import statistics
from collections import defaultdict

import numpy as np

from treat_sim.datasets import load_nelson_arrivals
from treat_sim.model import (
    Scenario,
    TreatmentCentreModel,
    SimulationSummary,
    DEFAULT_RESULTS_COLLECTION_PERIOD,
    DEFAULT_N_TRIAGE,
    DEFAULT_N_REG,
    DEFAULT_N_EXAM,
    DEFAULT_N_TRAUMA,
    DEFAULT_N_CUBICLES_1,
    DEFAULT_N_CUBICLES_2,
    DEFAULT_TRIAGE_MEAN,
    DEFAULT_REG_MEAN,
    DEFAULT_EXAM_MEAN,
    DEFAULT_TRAUMA_MEAN,
    DEFAULT_TRAUMA_TREAT_MEAN,
    DEFAULT_NON_TRAUMA_TREAT_MEAN,
    DEFAULT_NON_TRAUMA_TREAT_P,
    DEFAULT_PROB_TRAUMA,
)

UPSTREAM = {
    "project": "STARS treatment-centre model / treat-sim",
    "package": "treat-sim",
    "version": "3.0.0",
    "repository": "pythonhealthdatascience/stars-treat-sim",
    "commit": "e4a8c548d9ff7b36baa4fa117c492b66adcd78fa",
    "license": "MIT",
}

BASELINE = {
    "n_triage": DEFAULT_N_TRIAGE,
    "n_reg": DEFAULT_N_REG,
    "n_exam": DEFAULT_N_EXAM,
    "n_trauma": DEFAULT_N_TRAUMA,
    "n_cubicles_1": DEFAULT_N_CUBICLES_1,
    "n_cubicles_2": DEFAULT_N_CUBICLES_2,
    "triage_mean": DEFAULT_TRIAGE_MEAN,
    "reg_mean": DEFAULT_REG_MEAN,
    "exam_mean": DEFAULT_EXAM_MEAN,
    "trauma_mean": DEFAULT_TRAUMA_MEAN,
    "trauma_treat_mean": DEFAULT_TRAUMA_TREAT_MEAN,
    "non_trauma_treat_mean": DEFAULT_NON_TRAUMA_TREAT_MEAN,
    "non_trauma_treat_p": DEFAULT_NON_TRAUMA_TREAT_P,
    "prob_trauma": DEFAULT_PROB_TRAUMA,
    "demand_multiplier": 1.0,
    "duration": DEFAULT_RESULTS_COLLECTION_PERIOD,
    "seed": 17,
}

RESOURCE_KEYS = {
    "triage": "n_triage",
    "registration": "n_reg",
    "examination": "n_exam",
    "trauma": "n_trauma",
    "non_trauma_treatment": "n_cubicles_1",
    "trauma_treatment": "n_cubicles_2",
}


def _finite(x):
    try:
        return math.isfinite(float(x))
    except (TypeError, ValueError):
        return False


def _num(x, default=None):
    if _finite(x):
        return float(x)
    return default


def _safe(value):
    if isinstance(value, dict):
        return {k: _safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def _clip_int(v, low, high):
    return max(low, min(high, int(v)))


def _clip_float(v, low, high):
    return max(low, min(high, float(v)))


def _normalise_config(raw):
    cfg = dict(BASELINE)
    cfg.update(raw or {})
    cfg["n_triage"] = _clip_int(cfg["n_triage"], 1, 6)
    cfg["n_reg"] = _clip_int(cfg["n_reg"], 1, 6)
    cfg["n_exam"] = _clip_int(cfg["n_exam"], 1, 10)
    cfg["n_trauma"] = _clip_int(cfg["n_trauma"], 1, 6)
    cfg["n_cubicles_1"] = _clip_int(cfg["n_cubicles_1"], 1, 8)
    cfg["n_cubicles_2"] = _clip_int(cfg["n_cubicles_2"], 1, 8)
    cfg["triage_mean"] = _clip_float(cfg["triage_mean"], 0.2, 20)
    cfg["reg_mean"] = _clip_float(cfg["reg_mean"], 0.2, 30)
    cfg["exam_mean"] = _clip_float(cfg["exam_mean"], 0.5, 90)
    cfg["trauma_mean"] = _clip_float(cfg["trauma_mean"], 1, 240)
    cfg["trauma_treat_mean"] = _clip_float(cfg["trauma_treat_mean"], 1, 180)
    cfg["non_trauma_treat_mean"] = _clip_float(cfg["non_trauma_treat_mean"], 1, 120)
    cfg["non_trauma_treat_p"] = _clip_float(cfg["non_trauma_treat_p"], 0, 1)
    cfg["prob_trauma"] = _clip_float(cfg["prob_trauma"], 0, 1)
    cfg["demand_multiplier"] = _clip_float(cfg["demand_multiplier"], 0.25, 3.0)
    cfg["duration"] = _clip_float(cfg["duration"], 120, DEFAULT_RESULTS_COLLECTION_PERIOD)
    cfg["seed"] = _clip_int(cfg["seed"], 0, 2_147_483_647)
    return cfg


def _stage(name, queue_enter, wait, duration):
    """Build one stage if enough model state exists to locate it in time."""
    if queue_enter is None:
        return None
    out = {
        "stage": name,
        "queue_enter": float(queue_enter),
        "service_start": None,
        "service_end": None,
        "wait": None,
        "service_duration": None,
        "resource_id": None,
    }
    if _finite(wait):
        out["wait"] = float(wait)
        out["service_start"] = float(queue_enter + wait)
        if _finite(duration):
            out["service_duration"] = float(duration)
            out["service_end"] = float(out["service_start"] + duration)
    return out


def _patient_record(p, pathway):
    arrival = _num(p.arrival)
    stages = []
    if arrival is None:
        return None

    triage = _stage("triage", arrival, p.wait_triage, p.triage_duration)
    if triage:
        stages.append(triage)
    triage_end = triage["service_end"] if triage else None

    if pathway == "trauma":
        trauma = _stage("trauma", triage_end, p.wait_trauma, p.trauma_duration)
        if trauma:
            stages.append(trauma)
        trauma_end = trauma["service_end"] if trauma else None
        treatment = _stage(
            "trauma_treatment", trauma_end, p.wait_treat, p.treat_duration
        )
        if treatment:
            stages.append(treatment)
        require_treat = True
    else:
        registration = _stage(
            "registration", triage_end, p.wait_reg, p.reg_duration
        )
        if registration:
            stages.append(registration)
        reg_end = registration["service_end"] if registration else None
        examination = _stage("examination", reg_end, p.wait_exam, p.exam_duration)
        if examination:
            stages.append(examination)
        exam_end = examination["service_end"] if examination else None
        require_treat = bool(getattr(p, "require_treat", False))
        if require_treat:
            treatment = _stage(
                "non_trauma_treatment", exam_end, p.wait_treat, p.treat_duration
            )
            if treatment:
                stages.append(treatment)

    departure = None
    if _finite(p.total_time):
        departure = arrival + float(p.total_time)

    waits = [s["wait"] for s in stages if s["wait"] is not None]
    total_wait = sum(waits) if waits else 0.0
    return {
        "id": int(p.identifier),
        "pathway": pathway,
        "arrival": arrival,
        "departure": departure,
        "total_time": _num(p.total_time),
        "total_wait": total_wait,
        "requires_treatment": require_treat,
        "stages": stages,
    }


def _assign_resource_ids(patients, capacities):
    """Assign visual unit IDs consistent with actual SimPy service intervals.

    simpy.Resource models capacity but not named physical units. Unit IDs here are
    presentation metadata only; start/end times are untouched.
    """
    by_resource = defaultdict(list)
    for patient in patients:
        for stage in patient["stages"]:
            if stage["service_start"] is not None:
                by_resource[stage["stage"]].append((patient, stage))

    for resource, rows in by_resource.items():
        cap = max(1, int(capacities[resource]))
        free_at = [-float("inf")] * cap
        rows.sort(key=lambda x: (x[1]["service_start"], x[0]["id"]))
        for _, stage in rows:
            start = stage["service_start"]
            candidates = [i for i, t in enumerate(free_at) if t <= start + 1e-7]
            idx = candidates[0] if candidates else min(range(cap), key=free_at.__getitem__)
            stage["resource_id"] = idx + 1
            end = stage["service_end"]
            free_at[idx] = end if end is not None else float("inf")


def _events_from_patients(patients, horizon):
    events = []
    for patient in patients:
        pid = patient["id"]
        path = patient["pathway"]
        events.append({"time": patient["arrival"], "type": "arrival", "id": pid, "pathway": path})
        for i, stage in enumerate(patient["stages"]):
            qe = stage["queue_enter"]
            if qe is not None and qe <= horizon:
                base = {"id": pid, "pathway": path, "stage": stage["stage"], "resource_id": stage["resource_id"]}
                events.append({"time": qe, "type": "enter_queue", **base})
                events.append({"time": qe, "type": "request_resource", **base})
            ss = stage["service_start"]
            if ss is not None and ss <= horizon:
                events.append({"time": ss, "type": "start_service", "id": pid, "pathway": path, "stage": stage["stage"], "resource_id": stage["resource_id"]})
            se = stage["service_end"]
            if se is not None and se <= horizon:
                events.append({"time": se, "type": "end_service", "id": pid, "pathway": path, "stage": stage["stage"], "resource_id": stage["resource_id"]})
                if i < len(patient["stages"]) - 1:
                    events.append({"time": se, "type": "move_to_next_stage", "id": pid, "pathway": path, "from_stage": stage["stage"], "to_stage": patient["stages"][i + 1]["stage"]})
        if patient["departure"] is not None and patient["departure"] <= horizon:
            events.append({"time": patient["departure"], "type": "departure", "id": pid, "pathway": path})
    priority = {"arrival": 0, "end_service": 1, "departure": 2, "move_to_next_stage": 3, "enter_queue": 4, "request_resource": 5, "start_service": 6}
    events.sort(key=lambda e: (e["time"], priority.get(e["type"], 9), e["id"]))
    return events


def _max_queues(patients, horizon):
    by_stage = {}
    overall = 0
    stage_names = set(s["stage"] for p in patients for s in p["stages"])
    for stage_name in stage_names:
        points = []
        for patient in patients:
            for stage in patient["stages"]:
                if stage["stage"] != stage_name:
                    continue
                q = stage["queue_enter"]
                ss = stage["service_start"]
                if q is None or q > horizon:
                    continue
                if ss is not None and ss <= q + 1e-9:
                    continue
                points.append((q, 1))
                points.append((min(ss if ss is not None else horizon, horizon), -1))
        points.sort(key=lambda x: (x[0], x[1]))
        count = peak = 0
        for _, delta in points:
            count += delta
            peak = max(peak, count)
        by_stage[stage_name] = peak
        overall = max(overall, peak)
    return {"overall": overall, "by_stage": by_stage}


def _extra_metrics(patients, horizon):
    completed = [p for p in patients if p["departure"] is not None and p["departure"] <= horizon]
    waits = [p["total_wait"] for p in completed]
    times = [p["total_time"] for p in completed if p["total_time"] is not None]
    return {
        "completed": len(completed),
        "in_system_at_horizon": sum(1 for p in patients if p["arrival"] <= horizon and (p["departure"] is None or p["departure"] > horizon)),
        "median_total_wait": statistics.median(waits) if waits else None,
        "p95_total_wait": float(np.percentile(waits, 95)) if waits else None,
        "mean_total_wait": statistics.fmean(waits) if waits else None,
        "mean_time_in_system": statistics.fmean(times) if times else None,
    }


def run_stars_vr(config_json="{}"):
    raw = json.loads(config_json) if isinstance(config_json, str) else dict(config_json)
    cfg = _normalise_config(raw)

    arrivals = load_nelson_arrivals().copy()
    arrivals["arrival_rate"] = arrivals["arrival_rate"] * cfg["demand_multiplier"]

    scenario = Scenario(
        random_number_set=cfg["seed"],
        n_triage=cfg["n_triage"],
        n_reg=cfg["n_reg"],
        n_exam=cfg["n_exam"],
        n_trauma=cfg["n_trauma"],
        n_cubicles_1=cfg["n_cubicles_1"],
        n_cubicles_2=cfg["n_cubicles_2"],
        triage_mean=cfg["triage_mean"],
        reg_mean=cfg["reg_mean"],
        exam_mean=cfg["exam_mean"],
        trauma_mean=cfg["trauma_mean"],
        trauma_treat_mean=cfg["trauma_treat_mean"],
        non_trauma_treat_mean=cfg["non_trauma_treat_mean"],
        non_trauma_treat_p=cfg["non_trauma_treat_p"],
        prob_trauma=cfg["prob_trauma"],
        arrival_profile=arrivals,
    )

    model = TreatmentCentreModel(scenario)
    model.run(results_collection_period=cfg["duration"])
    summary = SimulationSummary(model)
    summary.process_run_results()

    patients = []
    for p in model.trauma_patients:
        record = _patient_record(p, "trauma")
        if record:
            patients.append(record)
    for p in model.non_trauma_patients:
        record = _patient_record(p, "non_trauma")
        if record:
            patients.append(record)
    patients.sort(key=lambda p: (p["arrival"], p["id"]))

    capacities = {resource: cfg[key] for resource, key in RESOURCE_KEYS.items()}
    _assign_resource_ids(patients, capacities)
    events = _events_from_patients(patients, cfg["duration"])

    result = {
        "upstream": UPSTREAM,
        "baseline": BASELINE,
        "config": cfg,
        "resource_capacities": capacities,
        "metrics": _safe(summary.results),
        "extra_metrics": _safe(_extra_metrics(patients, cfg["duration"])),
        "max_queue": _safe(_max_queues(patients, cfg["duration"])),
        "patients": _safe(patients),
        "events": _safe(events),
    }
    return json.dumps(result, separators=(",", ":"))
