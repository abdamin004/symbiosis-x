#!/usr/bin/env python3
"""Run the same repository checks locally and in CI.

    python scripts/check.py              # contracts, backend and frontend build
    python scripts/check.py --browser    # also the Playwright smoke test
    python scripts/check.py --release    # every suite; fails if a required one has not landed
    python scripts/check.py --list       # show suites and whether each has landed

The command exits nonzero when any selected suite fails, or when --release finds
a required suite missing.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = sys.executable
NPM = shutil.which("npm") or "npm"
NPX = shutil.which("npx") or "npx"


@dataclass(frozen=True)
class Suite:
    name: str
    command: tuple[str, ...]
    cwd: Path
    marker: Path
    """The file whose presence means the suite has landed."""
    kind: str = "default"
    """default runs every time; browser adds with --browser; release runs, and must exist, with --release."""


SUITES = (
    Suite("contracts",
          (PYTHON, "-m", "pytest", "backend/tests/integration/test_contract_examples.py", "-q"),
          ROOT, ROOT / "backend/tests/integration/test_contract_examples.py"),
    Suite("backend-unit", (PYTHON, "-m", "pytest", "backend/tests/unit", "-q"),
          ROOT, ROOT / "backend/tests/unit"),
    Suite("backend-integration", (PYTHON, "-m", "pytest", "backend/tests/integration", "-q"),
          ROOT, ROOT / "backend/tests/integration"),
    Suite("frontend-build", (NPM, "run", "build"), ROOT / "frontend", ROOT / "frontend/package.json"),
    Suite("browser-smoke", (NPX, "playwright", "test"),
          ROOT / "frontend", ROOT / "frontend/tests/smoke.spec.js", kind="browser"),
    Suite("asteria-flight", (NPX, "playwright", "test", "tests/asteria-flight.spec.js"),
          ROOT / "frontend", ROOT / "frontend/tests/asteria-flight.spec.js", kind="browser"),
    # Required at release (SX-26A health replay, SX-11A privacy); --release fails until both land.
    Suite("health-replay", (NPX, "playwright", "test", "tests/health-demo.spec.js"),
          ROOT / "frontend", ROOT / "frontend/tests/health-demo.spec.js", kind="release"),
    Suite("privacy", (PYTHON, "-m", "pytest", "backend/tests/integration/test_privacy.py", "-q"),
          ROOT, ROOT / "backend/tests/integration/test_privacy.py", kind="release"),
)


def select(args: argparse.Namespace) -> list[Suite]:
    if args.only:
        known = {suite.name: suite for suite in SUITES}
        unknown = [name for name in args.only if name not in known]
        if unknown:
            raise SystemExit(f"unknown suite: {', '.join(unknown)}")
        return [known[name] for name in args.only]
    if args.release:
        return list(SUITES)
    return [s for s in SUITES if s.kind == "default" or (s.kind == "browser" and args.browser)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--browser", action="store_true", help="also run the full Playwright browser suite")
    parser.add_argument("--release", action="store_true", help="run every suite and require all of them")
    parser.add_argument("--only", nargs="+", metavar="SUITE", help="run only the named suites")
    parser.add_argument("--list", action="store_true", help="list suites and exit")
    args = parser.parse_args(argv)

    if args.list:
        for suite in SUITES:
            state = "landed" if suite.marker.exists() else "missing"
            print(f"{suite.name:22} {state:8} {suite.kind}")
        return 0

    results: list[tuple[str, str, float]] = []
    for suite in select(args):
        if not suite.marker.exists():
            status = "MISSING" if args.release else "SKIPPED"
            results.append((suite.name, status, 0.0))
            print(f"\n== {suite.name}: {status} ({suite.marker.relative_to(ROOT)} has not landed)", flush=True)
            continue
        print(f"\n== {suite.name}: {' '.join(suite.command[1:])}", flush=True)
        started = time.monotonic()
        code = subprocess.run(suite.command, cwd=suite.cwd, env={**os.environ, "SX_TEST_PYTHON": PYTHON}).returncode
        results.append((suite.name, "PASSED" if code == 0 else f"FAILED ({code})", time.monotonic() - started))

    print("\nSummary")
    for name, status, seconds in results:
        print(f"  {name:22} {status:12} {seconds:5.1f}s")
    failed = [name for name, status, _ in results if status.startswith(("FAILED", "MISSING"))]
    if failed:
        print(f"\nChecks failed: {', '.join(failed)}")
        return 1
    print("\nAll selected checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
