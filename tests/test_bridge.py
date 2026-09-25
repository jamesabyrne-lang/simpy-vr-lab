import json
import math
from collections import defaultdict

import pytest

from stars_bridge import run_stars_vr
from treat_sim.model import Scenario, TreatmentCentreModel, SimulationSummary, RESULT_FIELDS


def run_bridge(seed=42, duration=300, **kwargs):
    config = {"seed": seed, "duration": duration}
    config.update(kwargs)
    return json.loads(run_stars_vr(json.dumps(config)))


def run_upstream(seed=42, duration=300, **scenario_kwargs):
    scenario = Scenario(random_number_set=seed, **scenario_kwargs)
    model = TreatmentCentreModel(scenario)
    model.run(results_collection_period=duration)
    summary = SimulationSummary(model)
    summary.process_run_results()
    return model, summary


@pytest.mark.parametrize("seed", [1, 42, 754])
def test_fixed_seed_bridge_matches_complete_upstream_summary(seed):
    data = run_bridge(seed=seed)
    _, summary = run_upstream(seed=seed)
    for key in RESULT_FIELDS:
        expected = summary.results[key]
        actual = data["metrics"][key]
        if expected != expected:  # NaN
            assert actual is None
        else:
            assert actual == pytest.approx(expected, rel=1e-11, abs=1e-11), key
    assert len(data["patients"]) == summary.results["00_arrivals"]
    assert data["extra_metrics"]["completed"] == summary.results["09_throughput"]


def test_patient_paths_waits_service_times_and_departures_match_upstream():
    duration = 420
    seed = 42
    data = run_bridge(seed=seed, duration=duration)
    model, _ = run_upstream(seed=seed, duration=duration)

    direct = {}
    for p in model.trauma_patients:
        direct[p.identifier] = ("trauma", p)
    for p in model.non_trauma_patients:
        direct[p.identifier] = ("non_trauma", p)

    stage_attrs = {
        "triage": ("wait_triage", "triage_duration"),
        "registration": ("wait_reg", "reg_duration"),
        "examination": ("wait_exam", "exam_duration"),
        "trauma": ("wait_trauma", "trauma_duration"),
        "non_trauma_treatment": ("wait_treat", "treat_duration"),
        "trauma_treatment": ("wait_treat", "treat_duration"),
    }

    assert {p["id"] for p in data["patients"]} == set(direct)
    for record in data["patients"]:
        pathway, upstream_patient = direct[record["id"]]
        assert record["pathway"] == pathway
        assert record["arrival"] == pytest.approx(upstream_patient.arrival)
        for stage in record["stages"]:
            wait_attr, duration_attr = stage_attrs[stage["stage"]]
            upstream_wait = getattr(upstream_patient, wait_attr)
            upstream_duration = getattr(upstream_patient, duration_attr)
            if stage["service_start"] is None:
                assert not math.isfinite(float(upstream_wait))
                assert stage["wait"] is None
                assert stage["service_duration"] is None
                assert stage["service_end"] is None
            else:
                assert stage["wait"] == pytest.approx(upstream_wait)
                assert stage["service_duration"] == pytest.approx(upstream_duration)
                assert stage["service_start"] == pytest.approx(stage["queue_enter"] + stage["wait"])
                assert stage["service_end"] == pytest.approx(stage["service_start"] + stage["service_duration"])
        if record["departure"] is not None:
            assert record["total_time"] == pytest.approx(upstream_patient.total_time)
            assert record["departure"] == pytest.approx(record["arrival"] + upstream_patient.total_time)


def test_visual_trace_never_precedes_simpy_times():
    data = run_bridge()
    for patient in data["patients"]:
        assert patient["arrival"] >= 0
        last_end = patient["arrival"]
        for stage in patient["stages"]:
            assert stage["queue_enter"] >= last_end - 1e-8
            if stage["service_start"] is not None:
                assert stage["service_start"] >= stage["queue_enter"] - 1e-8
            if stage["service_end"] is not None:
                assert stage["service_end"] >= stage["service_start"] - 1e-8
                last_end = stage["service_end"]
        if patient["departure"] is not None:
            assert patient["departure"] >= last_end - 1e-8


def test_visual_resource_ids_do_not_overlap_and_respect_capacity():
    data = run_bridge()
    intervals = defaultdict(list)
    for patient in data["patients"]:
        for stage in patient["stages"]:
            if stage["resource_id"] is not None and stage["service_start"] is not None:
                assert 1 <= stage["resource_id"] <= data["resource_capacities"][stage["stage"]]
                end = stage["service_end"] if stage["service_end"] is not None else data["config"]["duration"]
                intervals[(stage["stage"], stage["resource_id"])].append((stage["service_start"], end))

    for key, rows in intervals.items():
        rows.sort()
        for (_, previous_end), (next_start, _) in zip(rows, rows[1:]):
            assert next_start >= previous_end - 1e-7, key


def test_force_all_trauma():
    data = run_bridge(prob_trauma=1.0)
    assert data["patients"]
    assert {p["pathway"] for p in data["patients"]} == {"trauma"}
    assert all(any(s["stage"] == "trauma" for s in p["stages"]) for p in data["patients"])


def test_force_all_non_trauma_and_no_treatment():
    data = run_bridge(prob_trauma=0.0, non_trauma_treat_p=0.0)
    assert data["patients"]
    assert {p["pathway"] for p in data["patients"]} == {"non_trauma"}
    assert all(not any(s["stage"] == "non_trauma_treatment" for s in p["stages"]) for p in data["patients"])


def test_event_trace_matches_patient_stages():
    data = run_bridge()
    starts = {(e["id"], e.get("stage"), e["time"]) for e in data["events"] if e["type"] == "start_service"}
    departures = {(e["id"], e["time"]) for e in data["events"] if e["type"] == "departure"}
    for p in data["patients"]:
        for s in p["stages"]:
            if s["service_start"] is not None and s["service_start"] <= data["config"]["duration"]:
                assert (p["id"], s["stage"], s["service_start"]) in starts
        if p["departure"] is not None and p["departure"] <= data["config"]["duration"]:
            assert (p["id"], p["departure"]) in departures
