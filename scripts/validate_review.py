#!/usr/bin/env python3
"""Validate this review package, not the application it specifies.

Only stdlib; no network, credentials, paid calls or application execution.
"""
from __future__ import annotations
import argparse
import csv
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any

REVIEW_DATE = date(2026, 9, 16)

def load_json(root: Path, rel: str) -> Any:
    return json.loads((root / rel).read_text(encoding="utf-8"))

def validate(root: Path) -> dict[str, Any]:
    errors: list[str] = []
    try:
        canonical = load_json(root, "verification/CANONICAL_FILES.json")
        for rel in canonical:
            if not (root / rel).is_file():
                errors.append(f"Missing canonical file: {rel}")
        sources = load_json(root, "research/SOURCES.json")
        sids = [s["id"] for s in sources]
        if len(sids) != len(set(sids)):
            errors.append("Duplicate source IDs")
        for source in sources:
            if not re.fullmatch(r"S\d{2}", source["id"]):
                errors.append("Invalid source ID")
            if not source["url"].startswith("https://"):
                errors.append(f"Non-HTTPS source: {source['id']}")
            for key in ("retrieved", "published_or_updated"):
                value = source.get(key)
                if value and date.fromisoformat(value) > REVIEW_DATE:
                    errors.append(f"Future source date: {source['id']}")
        observations = load_json(root, "research/OBSERVATIONS.json")
        cids = [c["evidence_id"] for c in observations]
        if len(cids) != len(set(cids)):
            errors.append("Duplicate observation IDs")
        groups = [c["dedupe_group"] for c in observations]
        if len(groups) != len(set(groups)):
            errors.append("Duplicate retained incident groups")
        for observation in observations:
            if observation["source_id"] not in set(sids):
                errors.append("Unknown observation source")
            if observation["reproduction_status"] != "not_reproduced":
                errors.append("Review must not claim reproduced app complaints")
        with (root / "research/USER_COMPLAINTS.csv").open(newline="", encoding="utf-8") as handle:
            csv_rows = list(csv.DictReader(handle))
        if csv_rows != observations:
            errors.append("CSV and JSON observations differ")
        acceptance = (root / "specs/ACCEPTANCE_TESTS.md").read_text(encoding="utf-8")
        ids = re.findall(r"\*\*((?:[REJSM]\d{2}|V2-\d{2}))\s+—", acceptance)
        if len(ids) != len(set(ids)):
            errors.append("Duplicate acceptance IDs")
        if len(ids) != 90:
            errors.append(f"Expected 90 acceptance specifications, got {len(ids)}")
        cases = load_json(root, "evals/cases/review_seed_cases.json")
        eval_ids = [case["id"] for case in cases]
        if len(eval_ids) != len(set(eval_ids)):
            errors.append("Duplicate evaluation case IDs")
        for case in cases:
            if case["status"] != "draft_not_validated" or case["executed"] or case["human_validated"] or case["result"] is not None:
                errors.append("Draft evaluation case misrepresented as validated/executed")
            if not set(case["acceptance_ids"]).issubset(set(ids)):
                errors.append("Unknown acceptance reference in case")
        commands = load_json(root, "verification/COMMANDS.json")
        for command in commands:
            if command["status"] == "implemented_review_tool":
                target = command.get("implementation")
                if not target or not (root / target).is_file():
                    errors.append("Implemented command has no file")
                if command["network"] or command["paid"]:
                    errors.append("Review command cannot use network or spend")
            elif command["status"] == "proposed_application_command":
                if command["implementation"] is not None:
                    errors.append("Proposed application command has misleading implementation")
            else:
                errors.append("Unknown command status")
        for rel in ("apps/mobile/AGENTS.md", "apps/backend/AGENTS.md", "packages/research-core/AGENTS.md", "evals/AGENTS.md"):
            if not (root / rel).is_file():
                errors.append(f"Missing scoped instruction: {rel}")
        # Check source and observation references in explanatory files, not generated logs.
        for path in list((root / "docs").rglob("*.md")) + [root / "REVIEW.md"]:
            if path.is_file():
                text = path.read_text(encoding="utf-8")
                for ref in re.findall(r"\bC\d{2}\b", text):
                    if ref not in set(cids):
                        errors.append(f"Unknown complaint reference {ref} in {path.name}")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        errors.append(f"Unreadable or malformed review data: {exc}")
        return {"scope": "review_package_only", "ok": False, "errors": errors}
    return {
        "scope": "review_package_only",
        "ok": not errors,
        "source_count": len(sources),
        "observation_count": len(observations),
        "dedicated_2026_observations": sum(c["sample_class"] == "dedicated_2026" for c in observations),
        "acceptance_specification_count": len(ids),
        "draft_evaluation_case_count": len(cases),
        "application_tests_run": 0,
        "errors": errors,
    }

def check_manifest(root: Path) -> dict[str, Any]:
    errors: list[str] = []
    try:
        manifest = load_json(root, "MANIFEST.json")
        listed = set()
        for item in manifest["files"]:
            rel = item["path"]
            listed.add(rel)
            path = root / rel
            if not path.is_file():
                errors.append(f"Missing manifest file: {rel}")
                continue
            blob = path.read_bytes()
            if len(blob) != item["bytes"] or hashlib.sha256(blob).hexdigest() != item["sha256"]:
                errors.append(f"Manifest mismatch: {rel}")
        actual = {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() and p.name != "MANIFEST.json" and "__pycache__" not in p.parts}
        if actual != listed:
            errors.append("Manifest file set differs")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        errors.append(str(exc))
    return {"scope": "file_integrity_only", "ok": not errors, "errors": errors}

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--check-manifest", action="store_true")
    args = parser.parse_args()
    result = validate(args.root)
    if args.check_manifest:
        result["manifest"] = check_manifest(args.root)
        result["ok"] = result["ok"] and result["manifest"]["ok"]
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1

if __name__ == "__main__":
    sys.exit(main())
