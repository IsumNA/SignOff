"""SignOff backend — risk-classification benchmark harness.

Runs the *real* review pipeline (``mesh.run_mesh``) over a labelled set of
contract clauses and measures how well the assigned risk tier matches a
lawyer's gold label. This turns "is the AI any good?" into a number anyone can
reproduce.

What it reports
---------------
* **Tier accuracy** — exact-tier match rate across the set.
* **Escalation recall** — of the genuinely Tier-3 (escalate) clauses, how many
  the system caught. In legal risk this is the metric that matters most: a
  missed escalation is the expensive failure.
* **Escalation precision** — of the clauses flagged Tier 3, how many really were.
* **Adjacent accuracy** — within one tier (a Tier-2 called Tier-3 is cautious,
  not dangerous).
* **Confusion matrix** + per-clause results.

Modes
-----
The harness is honest about what it measured. With no credentials it scores the
deterministic **demo** classifier (a transparent keyword heuristic) — a baseline
that runs anywhere. With Vertex AI / NVIDIA configured it scores the **live**
multi-model mesh. The ``mode`` is recorded in the results file either way.

Usage
-----
    cd backend
    python evaluate.py                # run the benchmark, write eval/results.json
    python evaluate.py --quiet        # write results without the printed report
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from config import integration_status
from mesh import run_mesh

_EVAL_DIR = Path(__file__).resolve().parent / "eval"
_DATASET = _EVAL_DIR / "clauses.json"
_RESULTS = _EVAL_DIR / "results.json"

TIERS = (1, 2, 3)


def _load_dataset() -> Dict[str, Any]:
    with _DATASET.open("r", encoding="utf-8") as f:
        return json.load(f)


async def _predict_tier(clause: str, jurisdiction: str) -> Dict[str, Any]:
    """Run one clause through the mesh and return its predicted tier + posture."""
    result = await run_mesh(
        message=clause,
        session_id=f"eval-{datetime.now(timezone.utc).timestamp()}",
        jurisdiction=jurisdiction,
    )
    cls = result["classification"]
    modes = {t.get("mode") for t in result.get("traces", [])}
    return {
        "tier": int(cls["tier"]),
        "posture": cls["recommended_posture"],
        "confidence": cls.get("confidence"),
        "live": "live" in modes,
    }


def _metrics(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    n = len(rows)
    exact = sum(1 for r in rows if r["pred_tier"] == r["gold_tier"])
    adjacent = sum(1 for r in rows if abs(r["pred_tier"] - r["gold_tier"]) <= 1)

    # Escalation = Tier 3. Recall (caught the dangerous ones) and precision.
    gold_esc = [r for r in rows if r["gold_tier"] == 3]
    pred_esc = [r for r in rows if r["pred_tier"] == 3]
    true_esc = [r for r in pred_esc if r["gold_tier"] == 3]
    esc_recall = (len(true_esc) / len(gold_esc)) if gold_esc else None
    esc_precision = (len(true_esc) / len(pred_esc)) if pred_esc else None

    # Confusion matrix: matrix[gold][pred].
    matrix = {g: {p: 0 for p in TIERS} for g in TIERS}
    for r in rows:
        matrix[r["gold_tier"]][r["pred_tier"]] += 1

    # Per-tier recall.
    per_tier = {}
    for t in TIERS:
        gold_t = [r for r in rows if r["gold_tier"] == t]
        hit = sum(1 for r in gold_t if r["pred_tier"] == t)
        per_tier[t] = {
            "support": len(gold_t),
            "recall": round(hit / len(gold_t), 3) if gold_t else None,
        }

    return {
        "n": n,
        "tier_accuracy": round(exact / n, 3) if n else None,
        "adjacent_accuracy": round(adjacent / n, 3) if n else None,
        "escalation_recall": round(esc_recall, 3) if esc_recall is not None else None,
        "escalation_precision": (
            round(esc_precision, 3) if esc_precision is not None else None
        ),
        "per_tier": per_tier,
        "confusion_matrix": matrix,
    }


async def run_benchmark() -> Dict[str, Any]:
    data = _load_dataset()
    clauses = data["clauses"]
    jurisdiction = data.get("jurisdiction", "EU")

    rows: List[Dict[str, Any]] = []
    any_live = False
    for c in clauses:
        pred = await _predict_tier(c["clause"], jurisdiction)
        any_live = any_live or pred["live"]
        rows.append(
            {
                "id": c["id"],
                "category": c.get("category", ""),
                "gold_tier": int(c["gold_tier"]),
                "pred_tier": pred["tier"],
                "posture": pred["posture"],
                "confidence": pred["confidence"],
                "correct": pred["tier"] == int(c["gold_tier"]),
                "hard_case": bool(c.get("hard_case", False)),
            }
        )

    metrics = _metrics(rows)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "live" if any_live else "demo",
        "integrations": integration_status(),
        "dataset_size": len(clauses),
        "metrics": metrics,
        "results": rows,
    }


def _print_report(report: Dict[str, Any]) -> None:
    m = report["metrics"]
    print("\n" + "=" * 60)
    print(f"  SignOff risk-classification benchmark  [{report['mode'].upper()}]")
    print("=" * 60)
    print(f"  Clauses evaluated     : {m['n']}")
    print(f"  Tier accuracy         : {_pct(m['tier_accuracy'])}")
    print(f"  Adjacent (±1) accuracy: {_pct(m['adjacent_accuracy'])}")
    print(f"  Escalation recall     : {_pct(m['escalation_recall'])}  (caught dangerous clauses)")
    print(f"  Escalation precision  : {_pct(m['escalation_precision'])}")
    print("\n  Per-tier recall:")
    labels = {1: "Routine ", 2: "Material", 3: "Escalate"}
    for t in TIERS:
        pt = m["per_tier"][t]
        print(f"    Tier {t} {labels[t]} : {_pct(pt['recall'])}  (n={pt['support']})")

    print("\n  Confusion matrix (rows = gold, cols = predicted):")
    print("           pred:1  pred:2  pred:3")
    for g in TIERS:
        row = m["confusion_matrix"][g]
        print(f"    gold {g} : {row[1]:>6} {row[2]:>6} {row[3]:>6}")

    misses = [r for r in report["results"] if not r["correct"]]
    if misses:
        print(f"\n  Misclassified ({len(misses)}):")
        for r in misses:
            tag = " [hard case]" if r["hard_case"] else ""
            print(
                f"    {r['id']:<6} {r['category']:<16} "
                f"gold T{r['gold_tier']} → pred T{r['pred_tier']}{tag}"
            )
    print("=" * 60 + "\n")


def _pct(v: Any) -> str:
    return "—" if v is None else f"{round(v * 100):d}%"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the SignOff risk benchmark.")
    parser.add_argument(
        "--quiet", action="store_true", help="write results without printing the report"
    )
    args = parser.parse_args()

    report = asyncio.run(run_benchmark())
    _EVAL_DIR.mkdir(parents=True, exist_ok=True)
    with _RESULTS.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    if not args.quiet:
        _print_report(report)
    print(f"Results written to {_RESULTS.relative_to(Path.cwd()) if _RESULTS.is_relative_to(Path.cwd()) else _RESULTS}")


if __name__ == "__main__":
    sys.exit(main())
