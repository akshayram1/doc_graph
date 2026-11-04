"""Tests for seeded university data in Qdrant.

Run:
    python scripts/test_seed.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.services.store import (
    fetch_graph,
    search_nodes,
    get_client,
    ensure_collection,
)

EXPECTED_MIN_NODES = 30


def test_collection_exists():
    collection = ensure_collection()
    client = get_client()
    assert client.collection_exists(collection_name=collection), \
        f"Collection '{collection}' does not exist"
    print(f"[PASS] Collection '{collection}' exists")


def test_point_count():
    settings = get_settings()
    client = get_client()
    collection = ensure_collection()
    info = client.get_collection(collection_name=collection)
    count = info.points_count
    print(f"[INFO] Points in collection: {count}")
    assert count >= EXPECTED_MIN_NODES, \
        f"Expected at least {EXPECTED_MIN_NODES} points, got {count}"
    print(f"[PASS] Point count >= {EXPECTED_MIN_NODES}")


def test_search_returns_results():
    hits = search_nodes("machine learning", limit=5)
    assert len(hits) > 0, "Search for 'machine learning' returned no results"
    assert all(hit.score > 0 for hit in hits), "All hits should have positive scores"
    top_keys = [hit.key for hit in hits[:3]]
    print(f"[PASS] Search returned {len(hits)} hits. Top: {top_keys}")


def test_search_relevance():
    course_hits = search_nodes("data structures", limit=5)
    course_keys = [h.key for h in course_hits]
    assert "cs201" in course_keys, \
        f"Expected 'cs201' in top results for 'data structures', got {course_keys}"
    print(f"[PASS] 'cs201' found for 'data structures' query")


def test_graph_structure():
    graph = fetch_graph(limit=200)
    assert len(graph.nodes) > 0, "Graph should have nodes"
    assert len(graph.edges) > 0, "Graph should have edges"

    node_types = {n.type for n in graph.nodes}
    expected_types = {"student", "course", "skill", "faculty", "company", "job", "placement", "department"}
    missing = expected_types - node_types
    assert not missing, f"Missing node types in graph: {missing}"
    print(f"[PASS] Graph has {len(graph.nodes)} nodes, {len(graph.edges)} edges")
    print(f"[PASS] All expected node types present: {expected_types & node_types}")


def test_relations_in_payload():
    settings = get_settings()
    client = get_client()
    collection = ensure_collection()
    records, _ = client.scroll(
        collection_name=collection,
        limit=100,
        with_payload=True,
        with_vectors=False,
    )
    has_relations = False
    for record in records:
        payload = record.payload or {}
        relations = payload.get("relations", [])
        if relations:
            has_relations = True
            break
    assert has_relations, "No nodes found with relations in payload"
    print("[PASS] Relations found in node payloads")


def test_specific_node_exists():
    hits = search_nodes("database systems", limit=5)
    cs301_found = any(hit.key == "cs301" for hit in hits)
    assert cs301_found, "Expected 'cs301' node in search for 'database systems'"
    print("[PASS] cs301 node found via search for 'database systems'")


def main():
    tests = [
        ("Collection exists", test_collection_exists),
        ("Point count", test_point_count),
        ("Search returns results", test_search_returns_results),
        ("Search relevance", test_search_relevance),
        ("Graph structure", test_graph_structure),
        ("Relations in payload", test_relations_in_payload),
        ("Specific node exists", test_specific_node_exists),
    ]

    passed = 0
    failed = 0

    for name, test_fn in tests:
        print(f"\n--- Test: {name} ---")
        try:
            test_fn()
            passed += 1
        except AssertionError as exc:
            print(f"[FAIL] {exc}")
            failed += 1
        except Exception as exc:
            print(f"[ERROR] {type(exc).__name__}: {exc}")
            failed += 1

    print(f"\n{'=' * 40}")
    print(f"Results: {passed} passed, {failed} failed")
    print(f"{'=' * 40}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
