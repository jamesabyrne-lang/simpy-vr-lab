"""Lightweight STARS-inspired healthcare DES for the browser prototype.

This is intentionally simpler than the published STARS/treat-sim package.
SimPy remains the source of truth for arrivals, queues, resource contention,
service times, pathway branching and departures.  Three.js only visualises the
event trace returned by this module.
"""

import json
import math
import random
import statistics
from collections import defaultdict

import simpy

BASELINE = {
    "n_triage": 1,
    "n_reg": 1,
    "n_exam": 3,
    "n_trauma": 2,
    "n_cubicles_1": 1,
    "n_cubicles_2": 1,
    "triage_mean": 3.0,
    "reg_mean": 5.0,
    "exam_mean": 16.0,
    "trauma_mean": 90.0,
    "trauma_treat_mean": 30.0,
    "non_trauma_treat_mean": 13.3,
    "non_trauma_treat_p": 0.60,
    "prob_trauma": 0.12,
    "demand_multiplier": 1.0,
    "duration": 360.0,
    "seed": 17,
}

BASE_ARRIVAL_RATE_PER_MIN = 0.18

RESOURCE_KEYS = {
    "triage": "n_triage",
    "registration": "n_reg",
    "examination": "n_exam",
    "trauma": "n_trauma",
    "non_trauma_treatment": "n_cubicles_1",
    "trauma_treatment": "n_cubicles_2",
}


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _normalise_config(raw):
    cfg = dict(BASELINE)
    cfg.update(raw or {})
    for key, hi in [
        ("n_triage", 6), ("n_reg", 6), ("n_exam", 10),
        ("n_trauma", 6), ("n_cubicles_1", 8), ("n_cubicles_2", 8),
    ]:
        cfg[key] = int(_clamp(int(cfg[key]), 1, hi))
    for key, lo, hi in [
        ("triage_mean", 0.2, 20), ("reg_mean", 0.2, 30),
        ("exam_mean", 0.5, 90), ("trauma_mean", 1, 240),
        ("trauma_treat_mean", 1, 180), ("non_trauma_treat_mean", 1, 120),
        ("non_trauma_treat_p", 0, 1), ("prob_trauma", 0, 1),
        ("demand_multiplier", 0.25, 3), ("duration", 120, 720),
    ]:
        cfg[key] = float(_clamp(float(cfg[key]), lo, hi))
    cfg["seed"] = int(_clamp(int(cfg["seed"]), 0, 2_147_483_647))
    return cfg


def _gamma_sample(rng, mean, cv=0.35):
    if mean <= 0:
        return 0.01
    shape = 1.0 / (cv * cv)
    scale = mean / shape
    return max(0.01, rng.gammavariate(shape, scale))


class HealthcareModel:
    def __init__(self, cfg):
        self.cfg = cfg
        self.env = simpy.Environment()
        self.rng = random.Random(cfg["seed"])
        self.resources = {
            stage: simpy.Resource(self.env, capacity=cfg[key])
            for stage, key in RESOURCE_KEYS.items()
        }
        self.patients = []
        self.next_id = 1

    def service_time(self, stage):
        c = self.cfg
        if stage == "triage":
            return self.rng.expovariate(1.0 / c["triage_mean"])
        if stage == "registration":
            return _gamma_sample(self.rng, c["reg_mean"], 0.40)
        if stage == "examination":
            return _gamma_sample(self.rng, c["exam_mean"], 0.30)
        if stage == "trauma":
            return self.rng.expovariate(1.0 / c["trauma_mean"])
        if stage == "non_trauma_treatment":
            return _gamma_sample(self.rng, c["non_trauma_treat_mean"], 0.35)
        if stage == "trauma_treatment":
            return _gamma_sample(self.rng, c["trauma_treat_mean"], 0.35)
        raise KeyError(stage)

    def run_stage(self, patient, stage):
        record = {
            "stage": stage,
            "queue_enter": float(self.env.now),
            "service_start": None,
            "service_end": None,
            "wait": None,
            "service_duration": None,
            "resource_id": None,
        }
        patient["stages"].append(record)
        with self.resources[stage].request() as req:
            yield req
            record["service_start"] = float(self.env.now)
            record["wait"] = float(self.env.now - record["queue_enter"])
            duration = float(self.service_time(stage))
            record["service_duration"] = duration
            record["service_end"] = float(self.env.now + duration)
            yield self.env.timeout(duration)

    def patient_process(self, patient):
        yield from self.run_stage(patient, "triage")
        if patient["pathway"] == "trauma":
            yield from self.run_stage(patient, "trauma")
            yield from self.run_stage(patient, "trauma_treatment")
        else:
            yield from self.run_stage(patient, "registration")
            yield from self.run_stage(patient, "examination")
            patient["requires_treatment"] = self.rng.random() < self.cfg["non_trauma_treat_p"]
            if patient["requires_treatment"]:
                yield from self.run_stage(patient, "non_trauma_treatment")

        patient["departure"] = float(self.env.now)
        patient["total_time"] = float(self.env.now - patient["arrival"])
        patient["total_wait"] = float(sum(
            s["wait"] or 0.0 for s in patient["stages"] if s["wait"] is not None
        ))

    def arrivals(self):
        rate = BASE_ARRIVAL_RATE_PER_MIN * self.cfg["demand_multiplier"]
        while True:
            yield self.env.timeout(self.rng.expovariate(rate))
            if self.env.now >= self.cfg["duration"]:
                return
            pathway = "trauma" if self.rng.random() < self.cfg["prob_trauma"] else "non_trauma"
            patient = {
                "id": self.next_id,
                "pathway": pathway,
                "arrival": float(self.env.now),
                "departure": None,
                "total_time": None,
                "total_wait": 0.0,
                "requires_treatment": pathway == "trauma",
                "stages": [],
            }
            self.next_id += 1
            self.patients.append(patient)
            self.env.process(self.patient_process(patient))

    def run(self):
        self.env.process(self.arrivals())
        self.env.run(until=self.cfg["duration"])


def _assign_resource_ids(patients, capacities, horizon):
    by_stage = defaultdict(list)
    for patient in patients:
        for stage in patient["stages"]:
            if stage["service_start"] is not None:
                by_stage[stage["stage"]].append(stage)

    for stage_name, stages in by_stage.items():
        capacity = max(1, int(capacities[stage_name]))
        free_at = [-1.0] * capacity
        for stage in sorted(stages, key=lambda s: (s["service_start"], s["service_end"] or horizon)):
            available = [i for i, t in enumerate(free_at) if t <= stage["service_start"] + 1e-9]
            idx = available[0] if available else min(range(capacity), key=free_at.__getitem__)
            stage["resource_id"] = idx + 1
            free_at[idx] = stage["service_end"] if stage["service_end"] is not None else horizon


def _events(patients, horizon):
    rows = []
    for p in patients:
        rows.append({"time": p["arrival"], "type": "arrival", "id": p["id"], "pathway": p["pathway"]})
        for i, s in enumerate(p["stages"]):
            base = {
                "id": p["id"], "pathway": p["pathway"],
                "stage": s["stage"], "resource_id": s["resource_id"],
            }
            if s["queue_enter"] <= horizon:
                rows.append({"time": s["queue_enter"], "type": "enter_queue", **base})
                rows.append({"time": s["queue_enter"], "type": "request_resource", **base})
            if s["service_start"] is not None and s["service_start"] <= horizon:
                rows.append({"time": s["service_start"], "type": "start_service", **base})
            if s["service_end"] is not None and s["service_end"] <= horizon:
                rows.append({"time": s["service_end"], "type": "end_service", **base})
                if i < len(p["stages"]) - 1:
                    rows.append({
                        "time": s["service_end"], "type": "move_to_next_stage",
                        "id": p["id"], "pathway": p["pathway"],
                        "from_stage": s["stage"], "to_stage": p["stages"][i + 1]["stage"],
                    })
        if p["departure"] is not None and p["departure"] <= horizon:
            rows.append({"time": p["departure"], "type": "departure", "id": p["id"], "pathway": p["pathway"]})

    priority = {
        "arrival": 0, "end_service": 1, "departure": 2,
        "move_to_next_stage": 3, "enter_queue": 4,
        "request_resource": 5, "start_service": 6,
    }
    rows.sort(key=lambda e: (e["time"], priority.get(e["type"], 9), e["id"]))
    return rows


def _max_queues(patients, horizon):
    result = {}
    overall = 0
    for stage in RESOURCE_KEYS:
        points = []
        for p in patients:
            for s in p["stages"]:
                if s["stage"] != stage:
                    continue
                q = s["queue_enter"]
                start = s["service_start"]
                if q > horizon:
                    continue
                if start is not None and start <= q + 1e-9:
                    continue
                points.append((q, 1))
                points.append((min(start if start is not None else horizon, horizon), -1))
        points.sort(key=lambda x: (x[0], x[1]))
        current = peak = 0
        for _, delta in points:
            current += delta
            peak = max(peak, current)
        result[stage] = peak
        overall = max(overall, peak)
    return {"overall": overall, "by_stage": result}


def _utilisation(patients, capacities, horizon):
    busy = {k: 0.0 for k in capacities}
    for p in patients:
        for s in p["stages"]:
            if s["service_start"] is None:
                continue
            end = min(s["service_end"] if s["service_end"] is not None else horizon, horizon)
            busy[s["stage"]] += max(0.0, end - s["service_start"])
    return {
        k: busy[k] / (max(1, capacities[k]) * horizon)
        for k in capacities
    }


def run_healthcare_vr(config_json="{}"):
    raw = json.loads(config_json) if isinstance(config_json, str) else dict(config_json)
    cfg = _normalise_config(raw)
    model = HealthcareModel(cfg)
    model.run()

    capacities = {stage: cfg[key] for stage, key in RESOURCE_KEYS.items()}
    _assign_resource_ids(model.patients, capacities, cfg["duration"])

    completed = [
        p for p in model.patients
        if p["departure"] is not None and p["departure"] <= cfg["duration"]
    ]
    waits = [p["total_wait"] for p in completed]
    total_times = [p["total_time"] for p in completed if p["total_time"] is not None]
    util = _utilisation(model.patients, capacities, cfg["duration"])

    metrics = {
        "00_arrivals": len(model.patients),
        "09_throughput": len(completed),
        **{f"util_{k}": v for k, v in util.items()},
    }
    extra = {
        "completed": len(completed),
        "in_system_at_horizon": len(model.patients) - len(completed),
        "mean_total_wait": statistics.fmean(waits) if waits else None,
        "median_total_wait": statistics.median(waits) if waits else None,
        "p95_total_wait": (
            sorted(waits)[max(0, math.ceil(0.95 * len(waits)) - 1)] if waits else None
        ),
        "mean_time_in_system": statistics.fmean(total_times) if total_times else None,
    }

    payload = {
        "upstream": {
            "project": "STARS-inspired treatment-centre prototype",
            "version": "prototype-1",
            "note": "Simplified browser model; not an exact reproduction of STARS/treat-sim.",
        },
        "baseline": BASELINE,
        "config": cfg,
        "resource_capacities": capacities,
        "metrics": metrics,
        "extra_metrics": extra,
        "max_queue": _max_queues(model.patients, cfg["duration"]),
        "patients": model.patients,
        "events": _events(model.patients, cfg["duration"]),
    }
    return json.dumps(payload, separators=(",", ":"))
