"""Mutation tests for revision-3 handoff integrity, not application behavior."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from validate_builder_handoff import validate

class BuilderHandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)/'kit'
        shutil.copytree(Path(__file__).resolve().parents[1], self.root, ignore=shutil.ignore_patterns('__pycache__'))
    def tearDown(self): self.tmp.cleanup()
    def alter(self,path,fn):
        p=self.root/path; data=json.loads(p.read_text()); fn(data); p.write_text(json.dumps(data))
    def invalid(self,needle):
        result=validate(self.root)
        self.assertFalse(result['ok'],result)
        self.assertTrue(any(needle in e for e in result['errors']), result)
    def test_valid_package(self):
        result=validate(self.root)
        self.assertTrue(result['ok'],result)
        self.assertEqual(result['application_tests_run'],0)
    def test_missing_disposition(self):
        self.alter('verification/RECONCILIATION_DECISIONS.json',lambda d:d['decisions'].pop())
        self.invalid('coverage mismatch')
    def test_mutated_external_review(self):
        with (self.root/'reviews/independent_prebuild/REQUIRED CHANGES.md').open('a') as f: f.write('\nmodified\n')
        self.invalid('Submitted review bytes changed')
    def test_claimed_live_gate_pass(self):
        self.alter('verification/P0_ACCEPTANCE.json',lambda d:d['gates'][1].update(status='passed'))
        self.invalid('P0 evidence overstated')
    def test_deferred_safety(self):
        self.alter('verification/P0_ACCEPTANCE.json',lambda d:d.update(minimum_governance_security_accessibility_start_in_p0=False))
        self.invalid('Foundational P0 controls deferred')
    def test_stale_goal_archive(self):
        p=self.root/'Grok_Code_Deep_Research_Goal.md'; p.write_text(p.read_text().replace('Deep_Research_Builder_Kit_v3_2026-09-16.zip','old.zip'))
        self.invalid('stale archive')
    def test_unqualified_push_guarantee(self):
        p=self.root/'specs/ENGINE_CONTRACTS.md'; p.write_text(p.read_text()+'\nA push is idempotent per key regardless of retry count.\n')
        self.invalid('Unsupported external push guarantee')
    def test_mutated_original_sources(self):
        self.alter('research/SOURCES.json',lambda d:d[0].update(title='changed'))
        self.invalid('Retained original evidence changed')

if __name__=='__main__': unittest.main()
