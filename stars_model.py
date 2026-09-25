"""Browser-compatible STARS treatment-centre simulation with event tracing.

Derived from pythonhealthdatascience/stars-treat-sim (MIT), pinned source:
e4a8c548d9ff7b36baa4fa117c492b66adcd78fa (treat-sim 3.0.0 line).

The process logic, default parameters, random-stream construction, arrival
thinning algorithm and sampling parameterisations follow upstream treat-sim.
The adaptation removes pandas/sim-tools dependencies for Pyodide execution and
adds structured event/journey logging for Three.js/WebXR visualisation.
"""

import json
import math
from statistics import median

import numpy as np
import simpy

UPSTREAM_REPO = "https://github.com/pythonhealthdatascience/stars-treat-sim"
UPSTREAM_COMMIT = "e4a8c548d9ff7b36baa4fa117c492b66adcd78fa"
UPSTREAM_VERSION = "3.0.0"

DEFAULT_TRIAGE_MEAN = 3.0
DEFAULT_REG_MEAN = 5.0
DEFAULT_REG_VAR = 2.0
DEFAULT_EXAM_MEAN = 16.0
DEFAULT_EXAM_VAR = 3.0
DEFAULT_EXAM_MIN = 0.5
DEFAULT_TRAUMA_MEAN = 90.0
DEFAULT_TRAUMA_TREAT_MEAN = 30.0
DEFAULT_TRAUMA_TREAT_VAR = 4.0
DEFAULT_NON_TRAUMA_TREAT_MEAN = 13.3
DEFAULT_NON_TRAUMA_TREAT_VAR = 2.0
DEFAULT_NON_TRAUMA_TREAT_P = 0.60
DEFAULT_PROB_TRAUMA = 0.12
DEFAULT_N_TRIAGE = 1
DEFAULT_N_REG = 1
DEFAULT_N_EXAM = 3
DEFAULT_N_TRAUMA = 2
DEFAULT_N_CUBICLES_1 = 1
DEFAULT_N_CUBICLES_2 = 1
DEFAULT_RESULTS_COLLECTION_PERIOD = 60 * 19
N_STREAMS = 20

DEFAULT_ARRIVAL_RATES = [
    2.36666666666667, 2.8, 8.83333333333333, 10.4333333333333,
    14.8, 26.2666666666667, 31.4, 18.0666666666667, 16.4666666666667,
    12.0333333333333, 11.6, 28.8666666666667, 18.0333333333333,
    11.5, 5.3, 4.06666666666667, 2.2, 2.1,
]

STAGE_LABELS = {
    "triage": "Triage",
    "registration": "Registration",
    "examination": "Examination",
    "trauma": "Trauma stabilisation",
    "nontrauma_treatment": "Non-trauma treatment",
    "trauma_treatment": "Trauma treatment",
}


def _lognormal_params(mean, variance):
    phi = math.sqrt(variance + mean * mean)
    mu = math.log(mean * mean / phi)
    sigma = math.sqrt(math.log(phi * phi / (mean * mean)))
    return mu, sigma


class _Sampler:
    def __init__(self, rng, kind, *params):
        self.rng = rng
        self.kind = kind
        self.params = params

    def sample(self):
        if self.kind == "exp":
            return float(self.rng.exponential(self.params[0]))
        if self.kind == "uniform":
            return float(self.rng.uniform(self.params[0], self.params[1]))
        if self.kind == "bernoulli":
            return int(self.rng.binomial(1, self.params[0]))
        if self.kind == "lognormal":
            return float(self.rng.lognormal(self.params[0], self.params[1]))
        if self.kind == "normal_min":
            value = float(self.rng.normal(self.params[0], self.params[1]))
            return max(self.params[2], value)
        raise ValueError(self.kind)


class Scenario:
    def __init__(
        self,
        seed=17,
        n_triage=DEFAULT_N_TRIAGE,
        n_reg=DEFAULT_N_REG,
        n_exam=DEFAULT_N_EXAM,
        n_trauma=DEFAULT_N_TRAUMA,
        n_cubicles_1=DEFAULT_N_CUBICLES_1,
        n_cubicles_2=DEFAULT_N_CUBICLES_2,
        triage_mean=DEFAULT_TRIAGE_MEAN,
        reg_mean=DEFAULT_REG_MEAN,
        reg_var=DEFAULT_REG_VAR,
        exam_mean=DEFAULT_EXAM_MEAN,
        exam_var=DEFAULT_EXAM_VAR,
        exam_min=DEFAULT_EXAM_MIN,
        trauma_mean=DEFAULT_TRAUMA_MEAN,
        trauma_treat_mean=DEFAULT_TRAUMA_TREAT_MEAN,
        trauma_treat_var=DEFAULT_TRAUMA_TREAT_VAR,
        non_trauma_treat_mean=DEFAULT_NON_TRAUMA_TREAT_MEAN,
        non_trauma_treat_var=DEFAULT_NON_TRAUMA_TREAT_VAR,
        non_trauma_treat_p=DEFAULT_NON_TRAUMA_TREAT_P,
        prob_trauma=DEFAULT_PROB_TRAUMA,
        arrival_scale=1.0,
        arrival_rates=None,
    ):
        self.seed = int(seed)
        self.n_triage = max(1, int(n_triage))
        self.n_reg = max(1, int(n_reg))
        self.n_exam = max(1, int(n_exam))
        self.n_trauma = max(1, int(n_trauma))
        self.n_cubicles_1 = max(1, int(n_cubicles_1))
        self.n_cubicles_2 = max(1, int(n_cubicles_2))
        self.triage_mean = float(triage_mean)
        self.reg_mean = float(reg_mean)
        self.reg_var = float(reg_var)
        self.exam_mean = float(exam_mean)
        self.exam_var = float(exam_var)
        self.exam_min = float(exam_min)
        self.trauma_mean = float(trauma_mean)
        self.trauma_treat_mean = float(trauma_treat_mean)
        self.trauma_treat_var = float(trauma_treat_var)
        self.non_trauma_treat_mean = float(non_trauma_treat_mean)
        self.non_trauma_treat_var = float(non_trauma_treat_var)
        self.non_trauma_treat_p = float(non_trauma_treat_p)
        self.prob_trauma = float(prob_trauma)
        self.arrival_scale = max(0.05, float(arrival_scale))
        base = DEFAULT_ARRIVAL_RATES if arrival_rates is None else arrival_rates
        if len(base) != 18:
            raise ValueError("arrival_rates must contain 18 hourly rates")
        self.arrival_rates = [float(x) * self.arrival_scale for x in base]
        self._init_sampling()

    def _init_sampling(self):
        seeds = np.random.SeedSequence(self.seed).spawn(N_STREAMS)
        self.triage_dist = _Sampler(np.random.default_rng(seeds[0]), "exp", self.triage_mean)
        mu, sigma = _lognormal_params(self.reg_mean, self.reg_var)
        self.reg_dist = _Sampler(np.random.default_rng(seeds[1]), "lognormal", mu, sigma)
        self.exam_dist = _Sampler(
            np.random.default_rng(seeds[2]), "normal_min", self.exam_mean,
            math.sqrt(self.exam_var), self.exam_min
        )
        self.trauma_dist = _Sampler(np.random.default_rng(seeds[3]), "exp", self.trauma_mean)
        mu, sigma = _lognormal_params(self.non_trauma_treat_mean, self.non_trauma_treat_var)
        self.nt_treat_dist = _Sampler(np.random.default_rng(seeds[4]), "lognormal", mu, sigma)
        mu, sigma = _lognormal_params(self.trauma_treat_mean, self.trauma_treat_var)
        self.trauma_treat_dist = _Sampler(np.random.default_rng(seeds[5]), "lognormal", mu, sigma)
        self.nt_p_treat_dist = _Sampler(np.random.default_rng(seeds[6]), "bernoulli", self.non_trauma_treat_p)
        self.p_trauma_dist = _Sampler(np.random.default_rng(seeds[7]), "bernoulli", self.prob_trauma)
        self.lambda_max = max(self.arrival_rates)
        self.arrival_dist = _Sampler(np.random.default_rng(seeds[8]), "exp", 60.0 / self.lambda_max)
        self.thinning_rng = _Sampler(np.random.default_rng(seeds[9]), "uniform", 0.0, 1.0)


class _Units:
    def __init__(self, capacities):
        self.free = {k: list(range(v)) for k, v in capacities.items()}

    def acquire(self, stage):
        return self.free[stage].pop(0)

    def release(self, stage, unit):
        self.free[stage].append(unit)
        self.free[stage].sort()


class TreatmentCentreModel:
    def __init__(self, scenario, run_length=DEFAULT_RESULTS_COLLECTION_PERIOD):
        self.args = scenario
        self.run_length = float(run_length)
        self.env = simpy.Environment()
        self.events = []
        self.patients = []
        self.trauma_patients = []
        self.non_trauma_patients = []
        self._init_resources()

    def _init_resources(self):
        a = self.args
        self.resources = {
            "triage": simpy.Resource(self.env, capacity=a.n_triage),
            "registration": simpy.Resource(self.env, capacity=a.n_reg),
            "examination": simpy.Resource(self.env, capacity=a.n_exam),
            "trauma": simpy.Resource(self.env, capacity=a.n_trauma),
            "nontrauma_treatment": simpy.Resource(self.env, capacity=a.n_cubicles_1),
            "trauma_treatment": simpy.Resource(self.env, capacity=a.n_cubicles_2),
        }
        self.units = _Units({k: r.capacity for k, r in self.resources.items()})

    def log(self, event_type, patient, stage=None, **extra):
        e = {
            "time": round(float(self.env.now), 6),
            "type": event_type,
            "patient_id": patient["id"],
            "pathway": patient["pathway"],
        }
        if stage is not None:
            e["stage"] = stage
        e.update(extra)
        self.events.append(e)

    def _service(self, patient, stage, sampler):
        res = self.resources[stage]
        q_enter = float(self.env.now)
        self.log("enter_queue", patient, stage, queue_length=len(res.queue))
        with res.request() as req:
            yield req
            start = float(self.env.now)
            unit = self.units.acquire(stage)
            duration = float(sampler.sample())
            self.log(
                "start_service", patient, stage,
                resource_id=f"{stage}:{unit}", resource_unit=unit,
                wait=round(start - q_enter, 6), duration=round(duration, 6)
            )
            patient["journey"].append({
                "stage": stage,
                "label": STAGE_LABELS[stage],
                "queue_enter": round(q_enter, 6),
                "service_start": round(start, 6),
                "service_end": round(start + duration, 6),
                "resource_id": f"{stage}:{unit}",
                "resource_unit": unit,
                "wait": round(start - q_enter, 6),
                "duration": round(duration, 6),
            })
            try:
                yield self.env.timeout(duration)
                self.log(
                    "end_service", patient, stage,
                    resource_id=f"{stage}:{unit}", resource_unit=unit
                )
            finally:
                self.units.release(stage, unit)

    def trauma_pathway(self, patient):
        yield from self._service(patient, "triage", self.args.triage_dist)
        self.log("move_to_next_stage", patient, to_stage="trauma")
        yield from self._service(patient, "trauma", self.args.trauma_dist)
        self.log("move_to_next_stage", patient, to_stage="trauma_treatment")
        yield from self._service(patient, "trauma_treatment", self.args.trauma_treat_dist)
        patient["departure"] = round(float(self.env.now), 6)
        patient["total_time"] = round(float(self.env.now) - patient["arrival"], 6)
        self.log("departure", patient)

    def nontrauma_pathway(self, patient):
        yield from self._service(patient, "triage", self.args.triage_dist)
        self.log("move_to_next_stage", patient, to_stage="registration")
        yield from self._service(patient, "registration", self.args.reg_dist)
        self.log("move_to_next_stage", patient, to_stage="examination")
        yield from self._service(patient, "examination", self.args.exam_dist)
        requires = bool(self.args.nt_p_treat_dist.sample())
        patient["requires_treatment"] = requires
        if requires:
            self.log("move_to_next_stage", patient, to_stage="nontrauma_treatment")
            yield from self._service(patient, "nontrauma_treatment", self.args.nt_treat_dist)
        patient["departure"] = round(float(self.env.now), 6)
        patient["total_time"] = round(float(self.env.now) - patient["arrival"], 6)
        self.log("departure", patient)

    def arrivals_generator(self):
        patient_count = 0
        while True:
            t = int(self.env.now // 60) % len(self.args.arrival_rates)
            lambda_t = self.args.arrival_rates[t]
            u = math.inf
            interarrival = 0.0
            while u >= (lambda_t / self.args.lambda_max):
                interarrival += self.args.arrival_dist.sample()
                u = self.args.thinning_rng.sample()
            yield self.env.timeout(interarrival)
            pathway = "trauma" if self.args.p_trauma_dist.sample() else "non-trauma"
            p = {
                "id": patient_count,
                "pathway": pathway,
                "arrival": round(float(self.env.now), 6),
                "departure": None,
                "total_time": None,
                "requires_treatment": None,
                "journey": [],
            }
            self.patients.append(p)
            self.log("arrival", p)
            if pathway == "trauma":
                self.trauma_patients.append(p)
                self.env.process(self.trauma_pathway(p))
            else:
                self.non_trauma_patients.append(p)
                self.env.process(self.nontrauma_pathway(p))
            patient_count += 1

    def run(self):
        self.env.process(self.arrivals_generator())
        self.env.run(until=self.run_length)
        return self.result()

    def result(self):
        metrics_upstream = self._upstream_metrics()
        waits = [s["wait"] for p in self.patients for s in p["journey"]]
        completed = [p for p in self.patients if p["departure"] is not None]
        total_times = [p["total_time"] for p in completed]
        waits_sorted = sorted(waits)
        p95 = waits_sorted[max(0, math.ceil(0.95 * len(waits_sorted)) - 1)] if waits_sorted else 0.0
        metrics = {
            "arrivals": len(self.patients),
            "throughput": len(completed),
            "in_system_at_end": len(self.patients) - len(completed),
            "mean_wait_all_stages": round(float(np.mean(waits)), 3) if waits else 0.0,
            "median_wait_all_stages": round(float(median(waits)), 3) if waits else 0.0,
            "p95_wait_all_stages": round(float(p95), 3),
            "mean_time_in_system": round(float(np.mean(total_times)), 3) if total_times else 0.0,
            "trauma_patients": len(self.trauma_patients),
            "nontrauma_patients": len(self.non_trauma_patients),
            "upstream": metrics_upstream,
        }
        return {
            "provenance": {
                "upstream_repo": UPSTREAM_REPO,
                "upstream_commit": UPSTREAM_COMMIT,
                "upstream_version": UPSTREAM_VERSION,
                "licence": "MIT",
                "adaptation": "Browser/Pyodide event-traced port preserving treat-sim 3.0.0 process and RNG semantics",
            },
            "params": self._params(),
            "metrics": metrics,
            "patients": self.patients,
            "events": self.events,
            "resource_capacities": {k: v.capacity for k, v in self.resources.items()},
            "run_length": self.run_length,
        }

    def _params(self):
        a = self.args
        return {
            "seed": a.seed,
            "arrival_scale": a.arrival_scale,
            "n_triage": a.n_triage,
            "n_reg": a.n_reg,
            "n_exam": a.n_exam,
            "n_trauma": a.n_trauma,
            "n_cubicles_1": a.n_cubicles_1,
            "n_cubicles_2": a.n_cubicles_2,
            "prob_trauma": a.prob_trauma,
            "non_trauma_treat_p": a.non_trauma_treat_p,
            "exam_mean": a.exam_mean,
            "trauma_treat_mean": a.trauma_treat_mean,
            "non_trauma_treat_mean": a.non_trauma_treat_mean,
        }

    def _upstream_metrics(self):
        rc = self.run_length

        def values(pathways, stage, field):
            out = []
            for p in pathways:
                for s in p["journey"]:
                    if s["stage"] == stage:
                        out.append(s[field])
            return out

        def mean_or_nan(seq):
            return float(np.mean(seq)) if seq else float("nan")

        def util(pathways, stage, capacity):
            return float(sum(values(pathways, stage, "duration")) / (rc * capacity))

        allp = self.patients
        nt = self.non_trauma_patients
        tr = self.trauma_patients
        nt_totals = [p["total_time"] for p in nt if p["total_time"] is not None]
        tr_totals = [p["total_time"] for p in tr if p["total_time"] is not None]
        return {
            "00_arrivals": len(allp),
            "01a_triage_wait": mean_or_nan(values(allp, "triage", "wait")),
            "01b_triage_util": util(allp, "triage", self.args.n_triage),
            "02a_registration_wait": mean_or_nan(values(nt, "registration", "wait")),
            "02b_registration_util": util(nt, "registration", self.args.n_reg),
            "03a_examination_wait": mean_or_nan(values(nt, "examination", "wait")),
            "03b_examination_util": util(nt, "examination", self.args.n_exam),
            "04a_treatment_wait(non_trauma)": mean_or_nan(values(nt, "nontrauma_treatment", "wait")),
            "04b_treatment_util(non_trauma)": util(nt, "nontrauma_treatment", self.args.n_cubicles_1),
            "05_total_time(non-trauma)": mean_or_nan(nt_totals),
            "06a_trauma_wait": mean_or_nan(values(tr, "trauma", "wait")),
            "06b_trauma_util": util(tr, "trauma", self.args.n_trauma),
            "07a_treatment_wait(trauma)": mean_or_nan(values(tr, "trauma_treatment", "wait")),
            "07b_treatment_util(trauma)": util(tr, "trauma_treatment", self.args.n_cubicles_2),
            "08_total_time(trauma)": mean_or_nan(tr_totals),
            "09_throughput": sum(1 for p in allp if p["total_time"] is not None),
        }


def run_stars_simulation(**kwargs):
    run_length = float(kwargs.pop("run_length", DEFAULT_RESULTS_COLLECTION_PERIOD))
    scenario = Scenario(**kwargs)
    return TreatmentCentreModel(scenario, run_length=run_length).run()


def run_from_json(params_json):
    params = json.loads(params_json)
    return json.dumps(run_stars_simulation(**params), allow_nan=True)
