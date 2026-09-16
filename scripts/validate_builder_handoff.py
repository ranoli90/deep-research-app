#!/usr/bin/env python3
"""Revision-3 handoff checks only; never runs the application or calls a provider.

This validates a frozen planning deliverable. Do not treat its not_run/draft
assertions as runtime application gates after implementation begins.
"""
from __future__ import annotations
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any
from validate_review import validate as validate_review

SMOKE_IDS = ['R01','R04','R05','R09','R13','E01','E02','J01','J03','J05','S01','S09']
REVIEW_FILES = ['INDEPENDENT PREBUILD REVIEW.md','CLAIM VERIFICATION.csv','REQUIRED CHANGES.md','PROPOSED REPLACEMENTS.md']

def load(root: Path, rel: str) -> Any:
    return json.loads((root / rel).read_text(encoding='utf-8'))

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def validate(root: Path) -> dict[str, Any]:
    errors: list[str] = []
    initial = validate_review(root)
    errors.extend(initial.get('errors', []))
    try:
        decisions = load(root, 'verification/RECONCILIATION_DECISIONS.json')['decisions']
        ids = [d['id'] for d in decisions]
        expected = {f'RC-{i:02d}' for i in range(1,10)} | {'PBR-05'}
        if set(ids) != expected or len(ids) != len(expected):
            errors.append('Reconciliation disposition coverage mismatch')
        for decision in decisions:
            if not decision['disposition'] or not decision['reason']:
                errors.append('Empty decision disposition')
            for target in decision['targets']:
                if not (root / target).is_file(): errors.append(f'Missing decision target: {target}')
        gate = load(root, 'verification/P0_ACCEPTANCE.json')
        if gate['smoke_case_ids'] != SMOKE_IDS:
            errors.append('P0 smoke suite drift')
        if gate['status'] != 'specified_not_executed':
            errors.append('P0 evidence overstated')
        gids = {g['id'] for g in gate['gates']}
        if gids != {'P0-D','P0-L','P0-N'}:
            errors.append('P0 evidence gates not separated')
        for item in gate['gates']:
            if item['status'] != 'not_run': errors.append('P0 evidence overstated')
            if item['id'] == 'P0-N' and item['platform_status'] != {'ios':'not_run','android':'not_run'}:
                errors.append('Native evidence overstated')
        if gate['minimum_governance_security_accessibility_start_in_p0'] is not True:
            errors.append('Foundational P0 controls deferred')
        text = (root/'specs/ACCEPTANCE_TESTS.md').read_text()
        aids = re.findall(r'\*\*((?:[REJSM]\d{2}|V2-\d{2}))\s+—',text)
        if not set(SMOKE_IDS).issubset(set(aids)): errors.append('P0 references unknown acceptance cases')
        input_files = {i['filename']:i for i in load(root,'verification/RECONCILIATION_INPUTS.json')['files']}
        for name in REVIEW_FILES:
            path = root/'reviews/independent_prebuild'/name
            if digest(path) != input_files[name]['sha256']:
                errors.append(f'Submitted review bytes changed: {name}')
        if digest(root/'research/USER_COMPLAINTS.csv') != input_files['Deep_Research_Complaint_Evidence.csv']['sha256']:
            errors.append('Original complaint ledger changed')
        for item in load(root,'verification/V3_INVARIANTS.json')['retained_data']:
            if digest(root/item['path']) != item['sha256']:
                errors.append(f'Retained original evidence changed: {item["path"]}')
        goal = (root/'Grok_Code_Deep_Research_Goal.md').read_text()
        if not goal.startswith('/goal '): errors.append('Goal is not directly pasteable')
        if 'Deep_Research_Builder_Kit_v3_2026-09-16.zip' not in goal: errors.append('Goal references stale archive')
        if goal.index('FIRST IMPLEMENTATION CHECKPOINT') > goal.index('## 1.'):
            errors.append('P0 checkpoint not prominent')
        engine = (root/'specs/ENGINE_CONTRACTS.md').read_text()
        for required in ['completionEpoch','deviceBindingId','bindingEpoch','outcome_unknown','We cannot guarantee exactly one OS-visible alert']:
            if required not in engine: errors.append(f'Notification contract missing: {required}')
        if 'idempotent per key regardless of retry count' in engine:
            errors.append('Unsupported external push guarantee')
        sources = load(root,'research/RECONCILIATION_SOURCES.json')
        if [s['id'] for s in sources] != ['N01','N02','N03']:
            errors.append('Reconciliation source IDs differ')
        for source in sources:
            if not source['url'].startswith('https://') or date.fromisoformat(source['retrieved']) > date(2026,9,16):
                errors.append('Invalid reconciliation source metadata')
    except (OSError, ValueError, KeyError, TypeError) as exc:
        errors.append(f'Malformed handoff data: {exc}')
    return {'scope':'revision_3_handoff_document_integrity_only','ok':not errors,
            'application_tests_run':0,'errors':errors}

def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    args=parser.parse_args()
    result=validate(args.root)
    print(json.dumps(result,indent=2))
    return 0 if result['ok'] else 1

if __name__=='__main__': sys.exit(main())
