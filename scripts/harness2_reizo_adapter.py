# Copyright 2026 Reizo Studio / Google LLC (Apache-2.0 compatible bridge)
"""Direct Python adapter (`ReizoSubstrate` + `ReizoBenchmarkAdapter`) connecting
`E:\\CodeCode\\harness2` (`harness2.core.spec.BenchmarkAdapter`) to Reizo Studio (`e:\\CodeCode\\Reizo\\desktop`).

Allows running `harness2`'s Python recursion engine (`recursion.run_parallel` / `recursion.run_sequential`)
directly against Reizo Studio's headless agent & Office benchmark suite.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


class ReizoSubstrate:
    """Maps Reizo Studio's editable prompt/guardrails/memory/skills/sub_agents onto Harness²'s SurfaceSpec."""

    name = "reizo"

    def surface(self) -> Any:
        from harness2.core.tree import ComponentSpec, SurfaceSpec

        return SurfaceSpec(
            name="reizo",
            components=(
                ComponentSpec("c1_prompt", ("systemprompt.md",), always_on=True, cap_chars=8_000),
                ComponentSpec("c2_guardrails", ("guardrails.md",), always_on=True, cap_chars=6_000),
                ComponentSpec("c3_memory", ("memory.md",), always_on=True, cap_chars=6_000),
                ComponentSpec("c6_skills", ("skills/*/SKILL.md",), always_on=False, cap_lines=500),
                ComponentSpec("c7_subagents", ("sub_agents/*/AGENT.md",), always_on=False, cap_lines=300),
            ),
        )


class ReizoBenchmarkAdapter:
    """Implements `harness2.core.spec.BenchmarkAdapter` by delegating rollouts to Reizo's headless runner."""

    def __init__(self, reizo_root: Path, runs_root: Path) -> None:
        self.reizo_root = Path(reizo_root)
        self.runs_root = Path(runs_root)
        self.substrate = ReizoSubstrate()

    def tasks(self, split: str = "all") -> list[str]:
        return ["wb-excel-q1-budget", "wb-doc-policy-audit", "wb-ppt-exec-deck"]

    def domain_of(self, task_id: str) -> str:
        if "excel" in task_id:
            return "excel"
        if "doc" in task_id:
            return "document"
        return "presentation"

    def execute(self, task_id: str, harness_dir: Path | None, run_id: str, *, timeout: int | None = None) -> Path:
        out_dir = self.runs_root / run_id
        out_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["npm", "run", "test:eval", "--", "--output", str(out_dir)],
            cwd=str(self.reizo_root),
            check=True,
            timeout=timeout or 120,
            shell=True,
        )
        return out_dir / task_id / "comp1"

    def delivered(self, run_dir: Path) -> bool:
        return (Path(run_dir) / "deliverable.txt").is_file()

    def trajectory(self, run_dir: Path, *, obs_trunc: int = 50_000) -> str:
        p = Path(run_dir) / "trajectory.md"
        return p.read_text(encoding="utf-8")[:obs_trunc] if p.is_file() else ""

    def deliverable_text(self, run_dir: Path) -> str:
        p = Path(run_dir) / "deliverable.txt"
        return p.read_text(encoding="utf-8") if p.is_file() else ""

    def deliverable_files(self, run_dir: Path) -> dict[str, str]:
        return {"deliverable.txt": self.deliverable_text(run_dir)}

    def score(self, run_dir: Path, task_id: str) -> dict | None:
        summary_file = self.runs_root / "summary.json"
        if not summary_file.is_file():
            return None
        data = json.loads(summary_file.read_text(encoding="utf-8"))
        for item in data.get("tasks", []):
            if item.get("taskId") == task_id and item.get("adoptedScore") is not None:
                return {"score": float(item["adoptedScore"])}
        return None
