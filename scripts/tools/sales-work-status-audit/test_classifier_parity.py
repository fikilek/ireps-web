"""Frozen parity and stop-gate tests for the read-only audit classifier."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

from sales_work_status_classifier import (
    audit_reference_diagnostics,
    build_grouped_old_inputs,
    derive_new_sales_status,
    derive_old_frontend_status,
    inspect_preflight,
    inspect_tbrefs,
    normalize_meter_identity,
    normalize_new_sales_row,
    normalize_old_sales_row,
    normalize_registry_row,
    normalize_sales_work_status_ast_row,
    select_raw_tbrefs,
)


FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "classifier_parity.json").read_text(
        encoding="utf-8"
    )
)


class ClassifierParityTests(unittest.TestCase):
    def test_javascript_meter_identity_vocabulary(self):
        for case in FIXTURES["meterIdentity"]:
            with self.subTest(raw=case["raw"]):
                self.assertEqual(normalize_meter_identity(case["raw"]), case["expected"])

    def test_registry_api_projection_fallbacks(self):
        self.assertEqual(
            normalize_registry_row("SNAP", {"id": "DATA", "meterNo": "001"}),
            {"id": "SNAP", "meterId": "DATA", "meterNo": "001", "lmPcode": "NAv"},
        )
        self.assertEqual(
            normalize_registry_row("SNAP", {}),
            {"id": "SNAP", "meterId": "SNAP", "meterNo": "NAv", "lmPcode": "NAv"},
        )

    def test_ast_api_projection_fallback_chain(self):
        row = normalize_sales_work_status_ast_row(
            "AST-SNAP",
            {
                "ast": {"astData": {"astNo": "001"}},
                "astData": {"astNo": "002"},
                "master": {"id": "003"},
                "accessData": {"parents": {"lmPcode": "ZA5241"}},
            },
        )
        self.assertEqual(
            row,
            {"id": "AST-SNAP", "meterNo": "001", "masterId": "003", "lmPcode": "ZA5241"},
        )

    def test_old_frontend_registry_snapshot_id_fallback_completes(self):
        sales = normalize_old_sales_row("001", {"meterNo": "001", "lmPcode": "ZA5241"})
        registry = normalize_registry_row(
            "AST-SNAP", {"meterNo": "001", "parents": {"lmPcode": "ZA5241"}}
        )
        ast = normalize_sales_work_status_ast_row(
            "AST-SNAP",
            {
                "master": {"id": "001"},
                "accessData": {"parents": {"lmPcode": "ZA5241"}},
            },
        )
        registry_by_meter, ast_by_meter = build_grouped_old_inputs([registry], [ast])
        self.assertEqual(
            derive_old_frontend_status(
                sales, registry_by_meter["001"], ast_by_meter["001"], "ZA5241"
            ),
            "COMPLETED",
        )

    def test_selected_raw_source_uses_presence_not_truthiness(self):
        self.assertIsNone(select_raw_tbrefs({"tbRefs": None, "TbRefs": [{"id": "LEGACY"}]}))
        self.assertEqual(select_raw_tbrefs({"TbRefs": [{"id": "LEGACY"}]}), [{"id": "LEGACY"}])

    def test_valid_reference_is_individually_classifiable(self):
        reference = copy.deepcopy(FIXTURES["validInProgressReference"])
        row = normalize_new_sales_row(
            "001", {"master": {"visibility": "INVISIBLE"}, "tbRefs": [reference]}
        )
        self.assertTrue(row["tbRefsIntegrity"]["valid"])
        self.assertTrue(row["tbRefsIntegrity"]["entries"][0]["classifiable"])
        self.assertEqual(derive_new_sales_status(row), "IN_PROGRESS")

    def test_malformed_sibling_does_not_hide_valid_reference(self):
        reference = copy.deepcopy(FIXTURES["validInProgressReference"])
        row = normalize_new_sales_row(
            "001",
            {
                "master": {"visibility": "INVISIBLE"},
                "tbRefs": [{"id": "BROKEN"}, reference],
            },
        )
        self.assertFalse(row["tbRefsIntegrity"]["valid"])
        self.assertFalse(row["tbRefsIntegrity"]["entries"][0]["classifiable"])
        self.assertTrue(row["tbRefsIntegrity"]["entries"][1]["classifiable"])
        self.assertEqual(derive_new_sales_status(row), "IN_PROGRESS")

    def test_duplicate_logical_ids_are_suppressed_in_both_orders(self):
        valid = copy.deepcopy(FIXTURES["validInProgressReference"])
        duplicate = copy.deepcopy(valid)
        duplicate["id"] = " tb-1 "
        duplicate["rowId"] = "ROW-2"
        for references in ([valid, duplicate], [duplicate, valid]):
            with self.subTest(order=[entry["rowId"] for entry in references]):
                row = normalize_new_sales_row(
                    "001", {"master": {"visibility": "INVISIBLE"}, "tbRefs": references}
                )
                self.assertTrue(
                    all(
                        entry["duplicateLogicalIdentity"] and not entry["classifiable"]
                        for entry in row["tbRefsIntegrity"]["entries"]
                    )
                )
                self.assertEqual(derive_new_sales_status(row), "NOT_STARTED")

    def test_exact_correlation_collision_is_suppressed(self):
        valid = copy.deepcopy(FIXTURES["validInProgressReference"])
        collision = copy.deepcopy(valid)
        collision["fieldWork"]["updatedAt"] = {"seconds": 3, "nanoseconds": 0}
        row = normalize_new_sales_row(
            "001", {"master": {"visibility": "INVISIBLE"}, "tbRefs": [valid, collision]}
        )
        self.assertTrue(all(e["correlationAmbiguous"] for e in row["tbRefsIntegrity"]["entries"]))
        self.assertEqual(derive_new_sales_status(row), "NOT_STARTED")

    def test_visible_is_completed_without_reference_evidence(self):
        row = normalize_new_sales_row(
            "001", {"master": {"visibility": "VISIBLE"}, "tbRefs": "malformed"}
        )
        self.assertEqual(derive_new_sales_status(row), "COMPLETED")

    def test_preflight_stop_gates(self):
        malformed = inspect_preflight({"tbRefs": None, "TbRefs": [{"id": "TB-1"}]})
        self.assertTrue(malformed["canonicalMalformedWithLegacy"])
        alias = inspect_preflight(
            {"tbRefs": [{"id": "TB-1", "tbId": "TB-X", "tbRowId": "ROW-1"}]}
        )
        self.assertEqual(alias["legacyAliasConflict"], 1)
        self.assertEqual(alias["legacyAliasReliance"], 1)
        self.assertEqual(alias["canonicalIdLegacyRowReliance"], 1)

    def test_guarded_diagnostics_require_canonical_meter_evidence(self):
        base = {
            "master": {"visibility": "INVISIBLE"},
            "tbRefs": [
                {
                    "fieldWork": {
                        "status": "COMPLETED",
                        "outcomeCode": "METER_DISCOVERED",
                        "meterMatch": True,
                        "targetedMeterNo": "001",
                        "discoveredMeterNo": "001",
                    }
                }
            ],
        }
        self.assertEqual(
            audit_reference_diagnostics(base, "001")[
                "SALES_EXACT_METER_DISCOVERED_BUT_INVISIBLE"
            ],
            1,
        )
        self.assertEqual(
            audit_reference_diagnostics(base, "002")[
                "SALES_EXACT_METER_DISCOVERED_BUT_INVISIBLE"
            ],
            0,
        )

    def test_aggregate_integrity_contract_is_frozen(self):
        value = [
            {"id": "TB-1", "date": {"seconds": 1, "nanoseconds": 0}},
            {"id": " tb-1 ", "date": {"seconds": 2, "nanoseconds": 0}},
        ]
        integrity = inspect_tbrefs(value)
        self.assertFalse(integrity["valid"])
        self.assertEqual(integrity["issues"], ["tbRefs.1.id"])


if __name__ == "__main__":
    unittest.main()
