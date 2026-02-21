"""
SUNDAE Backend — Automated RAG Evaluation Pipeline (Task 6.7)

Scientifically measures RAG accuracy using the LLM-as-a-Judge pattern.
All inference runs 100% on-premise via local Ollama — no external API.

Usage:
    cd backend
    python -m scripts.evaluate_accuracy

    # Or with a custom test file:
    python -m scripts.evaluate_accuracy --test-file scripts/my_tests.json

    # Override organization_id:
    python -m scripts.evaluate_accuracy --org-id "your-org-uuid"

Requirements:
    - Supabase running (for vector search)
    - Ollama running with qwen3:14b loaded (for generation + judging)
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import logging
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import httpx

from app.core.config import get_settings
from app.services.ai_models import get_embedding_service, get_reranker_service
from app.services.llm_generator import generate_response
from app.services.vector_search import search_parent_chunks
from app.core.database import init_supabase, close_supabase

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════
# Data Models
# ═══════════════════════════════════════════════════════════════════


@dataclass
class TestCase:
    """A single evaluation test case."""

    question: str
    expected_answer: str
    is_in_document: bool


@dataclass
class EvalResult:
    """Result of evaluating a single test case."""

    question: str
    expected_answer: str
    actual_answer: str
    is_in_document: bool
    passed: bool
    judge_verdict: str  # "YES", "NO", "EXACT_MATCH", "EXACT_MISMATCH"
    latency_seconds: float


@dataclass
class EvalReport:
    """Aggregated evaluation report."""

    results: List[EvalResult] = field(default_factory=list)
    total: int = 0
    passed: int = 0
    failed: int = 0
    accuracy_pct: float = 0.0
    total_time_seconds: float = 0.0


# ═══════════════════════════════════════════════════════════════════
# Test Case Loader
# ═══════════════════════════════════════════════════════════════════


def load_test_cases(file_path: str) -> List[TestCase]:
    """Load test cases from a JSON file.

    Args:
        file_path: Path to the JSON file.

    Returns:
        List of TestCase objects.

    Raises:
        FileNotFoundError: If the file doesn't exist.
        ValueError: If the JSON structure is invalid.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Test file not found: {file_path}")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise ValueError("Test file must contain a JSON array of test cases.")

    cases = []
    for i, item in enumerate(data):
        if not all(k in item for k in ("question", "expected_answer", "is_in_document")):
            raise ValueError(
                f"Test case #{i+1} missing required fields: "
                "question, expected_answer, is_in_document"
            )
        cases.append(
            TestCase(
                question=item["question"],
                expected_answer=item["expected_answer"],
                is_in_document=item["is_in_document"],
            )
        )

    return cases


# ═══════════════════════════════════════════════════════════════════
# Execution Engine — Run RAG Pipeline
# ═══════════════════════════════════════════════════════════════════


async def run_rag_pipeline(
    question: str,
    organization_id: str,
) -> str:
    """Execute the full RAG pipeline for a single question.

    Calls services directly (bypasses HTTP layer for speed).

    Args:
        question:        The user's query.
        organization_id: Tenant ID for vector search isolation.

    Returns:
        The AI-generated answer string.
    """
    # Step 1 — Embed the query
    embedder = get_embedding_service()
    query_embedding = await embedder.embed_query(question)

    # Step 2 — Vector search (child → parent)
    parent_results = await search_parent_chunks(
        query_embedding=query_embedding,
        organization_id=organization_id,
    )

    # Step 3 — Rerank
    surviving_texts: List[str] = []
    if parent_results:
        reranker = get_reranker_service()
        parent_texts = [p.text for p in parent_results]
        rerank_results = await reranker.rerank(
            query=question,
            passages=parent_texts,
            score_threshold=0.3,
        )
        surviving_texts = [r.text for r in rerank_results]

    # Step 4 — Generate response
    answer = await generate_response(
        user_query=question,
        retrieved_contexts=surviving_texts,
    )

    return answer


# ═══════════════════════════════════════════════════════════════════
# LLM-as-a-Judge
# ═══════════════════════════════════════════════════════════════════

JUDGE_PROMPT = (
    "You are a strict evaluation judge. Compare two answers and determine "
    "if they contain the same core factual information and meaning.\n\n"
    "[Expected Answer]\n{expected}\n\n"
    "[Actual Answer]\n{actual}\n\n"
    "Do they convey the same key facts? Answer strictly with only YES or NO."
)


async def judge_with_llm(
    expected: str,
    actual: str,
    model: Optional[str] = None,
    ollama_base_url: Optional[str] = None,
) -> str:
    """Use a local LLM as a judge to compare two answers.

    Args:
        expected: The ground truth answer.
        actual:   The AI-generated answer.
        model:    Ollama model tag.
        ollama_base_url: Base URL for Ollama.

    Returns:
        "YES" or "NO" verdict.
    """
    settings = get_settings()
    target_model = model or settings.llm_model
    base_url = ollama_base_url or settings.ollama_base_url

    prompt = JUDGE_PROMPT.format(expected=expected, actual=actual)

    payload = {
        "model": target_model,
        "messages": [
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "options": {"temperature": 0.0},  # Deterministic judging
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(f"{base_url}/api/chat", json=payload)
            response.raise_for_status()

        data = response.json()
        verdict = data.get("message", {}).get("content", "").strip().upper()

        # Extract just YES or NO from the response
        if "YES" in verdict:
            return "YES"
        elif "NO" in verdict:
            return "NO"
        else:
            logger.warning("Judge returned ambiguous verdict: %s", verdict)
            return "NO"  # Conservative — treat ambiguous as failure

    except Exception as exc:
        logger.error("Judge LLM failed: %s", exc)
        return "ERROR"


def judge_adversarial(actual_answer: str) -> str:
    """Check if the AI correctly refused to answer (Zero Hallucination test).

    Args:
        actual_answer: The AI-generated response.

    Returns:
        "EXACT_MATCH" if refusal detected, "EXACT_MISMATCH" if it hallucinated.
    """
    refusal_phrase = "ไม่พบข้อมูลในเอกสาร"
    if refusal_phrase in actual_answer:
        return "EXACT_MATCH"
    return "EXACT_MISMATCH"


# ═══════════════════════════════════════════════════════════════════
# Evaluation Runner
# ═══════════════════════════════════════════════════════════════════


async def evaluate(
    test_cases: List[TestCase],
    organization_id: str,
) -> EvalReport:
    """Run the full evaluation pipeline.

    Args:
        test_cases:      List of test cases to evaluate.
        organization_id: Tenant ID for vector search.

    Returns:
        EvalReport with all results and metrics.
    """
    report = EvalReport()
    total_start = time.time()

    for i, tc in enumerate(test_cases, start=1):
        print(f"\n{'─' * 60}")
        print(f"  📝 Test Case {i}/{len(test_cases)}")
        print(f"  Q: {tc.question}")
        print(f"{'─' * 60}")

        # Run RAG pipeline
        start = time.time()
        actual_answer = await run_rag_pipeline(tc.question, organization_id)
        latency = time.time() - start

        # Judge the answer
        if tc.is_in_document:
            verdict = await judge_with_llm(tc.expected_answer, actual_answer)
            passed = verdict == "YES"
        else:
            verdict = judge_adversarial(actual_answer)
            passed = verdict == "EXACT_MATCH"

        result = EvalResult(
            question=tc.question,
            expected_answer=tc.expected_answer,
            actual_answer=actual_answer,
            is_in_document=tc.is_in_document,
            passed=passed,
            judge_verdict=verdict,
            latency_seconds=round(latency, 2),
        )
        report.results.append(result)

        # Live feedback
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  Expected : {tc.expected_answer[:80]}...")
        print(f"  Actual   : {actual_answer[:80]}...")
        print(f"  Verdict  : {verdict} → {status}  ({latency:.1f}s)")

    # Calculate metrics
    report.total = len(report.results)
    report.passed = sum(1 for r in report.results if r.passed)
    report.failed = report.total - report.passed
    report.accuracy_pct = (
        (report.passed / report.total * 100) if report.total > 0 else 0.0
    )
    report.total_time_seconds = round(time.time() - total_start, 2)

    return report


# ═══════════════════════════════════════════════════════════════════
# Report Printer
# ═══════════════════════════════════════════════════════════════════


def print_report(report: EvalReport) -> None:
    """Print a beautiful console report."""
    print("\n")
    print("═" * 70)
    print("  📊  SUNDAE RAG — EVALUATION REPORT")
    print("═" * 70)

    # Detail table header
    print(f"\n  {'#':<4} {'Type':<12} {'Verdict':<16} {'Time':<8} {'Status':<8}")
    print(f"  {'─'*4} {'─'*12} {'─'*16} {'─'*8} {'─'*8}")

    for i, r in enumerate(report.results, start=1):
        test_type = "📄 In-Doc" if r.is_in_document else "🎭 Trick"
        status = "✅ PASS" if r.passed else "❌ FAIL"
        latency = f"{r.latency_seconds:.1f}s"

        print(f"  {i:<4} {test_type:<12} {r.judge_verdict:<16} {latency:<8} {status:<8}")
        print(f"       Q: {r.question[:55]}...")

    # Summary
    print(f"\n{'═' * 70}")
    print(f"  📈 RESULTS SUMMARY")
    print(f"{'═' * 70}")
    print(f"  Total Test Cases  : {report.total}")
    print(f"  Passed            : {report.passed}")
    print(f"  Failed            : {report.failed}")
    print(f"  Total Time        : {report.total_time_seconds:.1f}s")
    print()

    # Accuracy with visual bar
    bar_len = 30
    filled = int(bar_len * report.accuracy_pct / 100)
    bar = "█" * filled + "░" * (bar_len - filled)
    kpi_status = "✅ KPI MET" if report.accuracy_pct >= 90.0 else "❌ KPI NOT MET"

    print(f"  ACCURACY: {report.accuracy_pct:.1f}%  [{bar}]  {kpi_status}")
    print(f"  Target  : ≥ 90.0%")
    print(f"{'═' * 70}\n")


# ═══════════════════════════════════════════════════════════════════
# CSV Export
# ═══════════════════════════════════════════════════════════════════


def export_csv(report: EvalReport, output_path: str) -> None:
    """Export evaluation results to a CSV file.

    Args:
        report:      The evaluation report.
        output_path: Path for the CSV file.
    """
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)

        # Header
        writer.writerow([
            "Test #",
            "Question",
            "Expected Answer",
            "Actual Answer",
            "Type",
            "Judge Verdict",
            "Passed",
            "Latency (s)",
        ])

        # Data rows
        for i, r in enumerate(report.results, start=1):
            writer.writerow([
                i,
                r.question,
                r.expected_answer,
                r.actual_answer,
                "In-Document" if r.is_in_document else "Adversarial",
                r.judge_verdict,
                "PASS" if r.passed else "FAIL",
                r.latency_seconds,
            ])

        # Summary row
        writer.writerow([])
        writer.writerow(["SUMMARY"])
        writer.writerow(["Total", report.total])
        writer.writerow(["Passed", report.passed])
        writer.writerow(["Failed", report.failed])
        writer.writerow(["Accuracy (%)", f"{report.accuracy_pct:.1f}"])
        writer.writerow(["Total Time (s)", report.total_time_seconds])

    logger.info("Results exported to: %s", path.resolve())


# ═══════════════════════════════════════════════════════════════════
# Main Entry Point
# ═══════════════════════════════════════════════════════════════════


async def main() -> None:
    """Main entry point for the evaluation pipeline."""
    parser = argparse.ArgumentParser(
        description="SUNDAE RAG — Automated Accuracy Evaluation"
    )
    parser.add_argument(
        "--test-file",
        default="scripts/test_cases.json",
        help="Path to test cases JSON file (default: scripts/test_cases.json)",
    )
    parser.add_argument(
        "--org-id",
        default="00000000-0000-0000-0000-000000000000",
        help="Organization ID to use for vector search",
    )
    parser.add_argument(
        "--output",
        default="scripts/evaluation_results.csv",
        help="Output CSV file path (default: scripts/evaluation_results.csv)",
    )
    args = parser.parse_args()

    print("\n🚀 SUNDAE RAG — Automated Evaluation Pipeline")
    print("=" * 50)
    print(f"  Test File : {args.test_file}")
    print(f"  Org ID    : {args.org_id}")
    print(f"  Output CSV: {args.output}")
    print("=" * 50)

    # Load test cases
    test_cases = load_test_cases(args.test_file)
    print(f"\n📋 Loaded {len(test_cases)} test cases")
    print(
        f"   ├─ In-document : {sum(1 for tc in test_cases if tc.is_in_document)}"
    )
    print(
        f"   └─ Adversarial : {sum(1 for tc in test_cases if not tc.is_in_document)}"
    )

    # Initialize Supabase
    print("\n⏳ Initializing Supabase connection...")
    await init_supabase()

    try:
        # Run evaluation
        report = await evaluate(test_cases, args.org_id)

        # Print report
        print_report(report)

        # Export CSV
        export_csv(report, args.output)

        # Exit code based on KPI
        if report.accuracy_pct < 90.0:
            print("⚠️  Accuracy below 90% KPI target!")
            sys.exit(1)

    finally:
        await close_supabase()


if __name__ == "__main__":
    asyncio.run(main())
