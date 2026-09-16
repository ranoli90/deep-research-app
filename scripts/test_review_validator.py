"""Tests only the review-data validator. No application or research tests."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from validate_review import validate

class ReviewValidatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "kit"
        shutil.copytree(Path(__file__).resolve().parents[1], self.root, ignore=shutil.ignore_patterns("__pycache__"))

    def tearDown(self):
        self.temp.cleanup()

    def alter(self, rel, fn):
        p = self.root / rel
        data = json.loads(p.read_text())
        fn(data)
        p.write_text(json.dumps(data))

    def assert_invalid(self, fragment):
        result = validate(self.root)
        self.assertFalse(result["ok"])
        self.assertTrue(any(fragment in error for error in result["errors"]), result)

    def test_valid_package(self):
        result = validate(self.root)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["application_tests_run"], 0)

    def test_duplicate_sources_rejected(self):
        self.alter("research/SOURCES.json", lambda data: data.append(data[0].copy()))
        self.assert_invalid("Duplicate source")

    def test_future_source_date_rejected(self):
        self.alter("research/SOURCES.json", lambda data: data[0].update(published_or_updated="2030-01-01"))
        self.assert_invalid("Future source date")

    def test_unknown_observation_source_rejected(self):
        self.alter("research/OBSERVATIONS.json", lambda data: data[0].update(source_id="S99"))
        self.assert_invalid("Unknown observation source")

    def test_fabricated_reproduction_rejected(self):
        self.alter("research/OBSERVATIONS.json", lambda data: data[0].update(reproduction_status="reproduced"))
        self.assert_invalid("must not claim reproduced")

    def test_fabricated_evaluation_result_rejected(self):
        self.alter("evals/cases/review_seed_cases.json", lambda data: data[0].update(executed=True,result="passed"))
        self.assert_invalid("misrepresented")

    def test_missing_canonical_file_rejected(self):
        (self.root / "PRODUCT.md").unlink()
        self.assert_invalid("Missing canonical file")

    def test_duplicate_case_rejected(self):
        self.alter("evals/cases/review_seed_cases.json", lambda data: data.append(data[0].copy()))
        self.assert_invalid("Duplicate evaluation case")

    def test_nonexistent_implemented_command_rejected(self):
        self.alter("verification/COMMANDS.json", lambda data: data[0].update(implementation="missing.py"))
        self.assert_invalid("Implemented command has no file")

if __name__ == "__main__":
    unittest.main()
