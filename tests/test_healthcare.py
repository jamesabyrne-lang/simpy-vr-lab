import json
from collections import defaultdict

from simulation import run_healthcare_vr


def run_model(**kwargs):
    cfg = {"seed": 42, "duration": 240}
    cfg.update(kwargs)
    return json.loads(run_healthcare_vr(json.dumps(cfg)))


def test_model_returns_complete_browser_schema():
    data = run_model()
    assert data["patients"]
    assert data["events"]
    assert data["metrics"]["00_arrivals"] == len(data["patients"])
    assert data["extra_metrics"]["completed"] == data["metrics"]["09_throughput"]
    assert set(data["resource_capacities"]) == {
        "triage", "registration", "examination", "trauma",
        "non_trauma_treatment", "trauma_treatment",
    }


def test_fixed_seed_is_reproducible():
    a = run_model(seed=7)
    b = run_model(seed=7)
    assert a["patients"] == b["patients"]
    assert a["events"] == b["events"]


def test_force_all_trauma():
    data = run_model(prob_trauma=1.0)
    assert {p["pathway"] for p in data["patients"]} == {"trauma"}
    assert all(any(s["stage"] == "trauma" for s in p["stages"]) for p in data["patients"])


def test_force_non_trauma_without_optional_treatment():
    data = run_model(prob_trauma=0.0, non_trauma_treat_p=0.0)
    assert {p["pathway"] for p in data["patients"]} == {"non_trauma"}
    assert all(
        not any(s["stage"] == "non_trauma_treatment" for s in p["stages"])
        for p in data["patients"]
    )


def test_resource_unit_intervals_do_not_overlap():
    data = run_model(duration=360)
    intervals = defaultdict(list)
    for p in data["patients"]:
        for s in p["stages"]:
            if s["service_start"] is None:
                continue
            assert s["resource_id"] is not None
            assert 1 <= s["resource_id"] <= data["resource_capacities"][s["stage"]]
            intervals[(s["stage"], s["resource_id"])].append(
                (s["service_start"], s["service_end"])
            )
    for key, rows in intervals.items():
        rows.sort()
        for (_, prev_end), (next_start, _) in zip(rows, rows[1:]):
            assert next_start >= prev_end - 1e-8, key


def test_event_trace_is_chronological():
    data = run_model()
    times = [e["time"] for e in data["events"]]
    assert times == sorted(times)
    for p in data["patients"]:
        for s in p["stages"]:
            assert s["queue_enter"] >= p["arrival"]
            if s["service_start"] is not None:
                assert s["service_start"] >= s["queue_enter"]
                assert s["service_end"] >= s["service_start"]
