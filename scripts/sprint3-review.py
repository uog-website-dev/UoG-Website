#!/usr/bin/env python3
"""Compatibility entry point for fail-closed Sprint 3 release evidence.

Use --live for the explicit isolated Site/profile seed, and --build to build
both Next applications without overwriting the running development output.
"""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("sprint3-release-audit.py")),run_name="__main__")
