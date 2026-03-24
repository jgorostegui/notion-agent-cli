#!/usr/bin/env -S uv run --project benchmark python
"""Benchmark runner: notion-agent-cli (NAC) vs MCP.

Sessions run sequentially with per-session fixture reset to avoid contamination.

Environment isolation:
    MCP mode:     runs in ~/.claude-bench-mcp HOME, zero built-in tools
    Actions mode: runs in ~/.claude-bench-actions HOME, zero MCP servers
    Both modes:   run from benchmark/envs/workdir/ (neutral, empty)

Setup: run `bash benchmark/envs/setup-envs.sh` once to bootstrap.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

try:
    import typer
except ImportError:
    print("typer not installed. Run: uv add typer --project benchmark", file=sys.stderr)
    sys.exit(1)

# ── Paths ────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
RESULTS_BASE = SCRIPT_DIR / "results"
WORKDIR = SCRIPT_DIR / "envs" / "workdir"
USER_HOME = Path.home()
MCP_HOME = USER_HOME / ".claude-bench-mcp"
ACTIONS_HOME = USER_HOME / ".claude-bench-actions"

app = typer.Typer(help="Benchmark runner: notion-agent-cli (NAC) vs MCP", add_completion=False)


# ── Config loaded from .env ──────────────────────────────────────────────────

@dataclass
class Env:
    """Benchmark fixture IDs loaded from .env."""
    BENCH_PAGE: str = ""
    BENCH_PARENT: str = ""
    BENCH_DB: str = ""
    BENCH_ENTRY: str = ""
    BENCH_ENTRIES: str = ""
    BENCH_MERGE_SOURCES: str = ""
    BENCH_SECTION: str = ""


env = Env()


def _load_env() -> None:
    """Load BENCH_* variables from .env file and environment."""
    env_file = PROJECT_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("export "):
                line = line[7:]
            if line.startswith("BENCH_") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

    for f in (
        "BENCH_PAGE", "BENCH_PARENT", "BENCH_DB", "BENCH_ENTRY",
        "BENCH_ENTRIES", "BENCH_MERGE_SOURCES", "BENCH_SECTION",
    ):
        setattr(env, f, os.environ.get(f, ""))

    if not env.BENCH_PAGE or not env.BENCH_PARENT:
        typer.echo("Error: BENCH_PAGE and BENCH_PARENT must be set in .env", err=True)
        raise typer.Exit(1)


# ── Environment isolation ────────────────────────────────────────────────────

def _reset_bench_homes() -> None:
    """Clear cached sessions from prior runs."""
    for bench_home in (MCP_HOME, ACTIONS_HOME):
        projects_dir = bench_home / ".claude" / "projects"
        if projects_dir.is_dir():
            shutil.rmtree(projects_dir)
            typer.echo(f"  Cleared {projects_dir}")


def _verify_bench_envs() -> None:
    """Fail fast if setup hasn't been run."""
    if not MCP_HOME.is_dir() or not ACTIONS_HOME.is_dir():
        typer.echo("Error: benchmark environments not set up.", err=True)
        typer.echo("Run: bash benchmark/envs/setup-envs.sh", err=True)
        raise typer.Exit(1)
    WORKDIR.mkdir(parents=True, exist_ok=True)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _run_quiet(cmd: list[str], **kwargs) -> str:
    """Run a command and return stdout, swallowing errors."""
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=10, **kwargs,
        ).stdout.strip()
    except Exception:
        return ""


def _write_env_json(
    results_dir: Path, *, scenarios: list[int], iterations: int,
    model: str, run_id: str,
) -> None:
    """Record full environment metadata."""
    mcp_env = dict(os.environ, HOME=str(MCP_HOME))
    actions_env = dict(os.environ, HOME=str(ACTIONS_HOME))

    def plugin_list(e: dict) -> list:
        out = _run_quiet(["claude", "plugin", "list", "--json"], env=e)
        try:
            return json.loads(out)
        except Exception:
            return []

    data = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "run_id": run_id,
        "claude_cli_version": _run_quiet(["claude", "--version"]).split("\n")[0],
        "model": model or "default",
        "git_commit": _run_quiet(
            ["git", "rev-parse", "--short", "HEAD"], cwd=PROJECT_DIR,
        ) or "unknown",
        "hostname": _run_quiet(["hostname", "-s"]),
        "os": f"{_run_quiet(['uname', '-s'])}-{_run_quiet(['uname', '-m'])}",
        "scenarios": scenarios,
        "iterations": iterations,
        "fixture_ids": {
            "BENCH_PAGE": env.BENCH_PAGE,
            "BENCH_PARENT": env.BENCH_PARENT,
            "BENCH_DB": env.BENCH_DB,
            "BENCH_ENTRY": env.BENCH_ENTRY,
            "BENCH_SECTION": env.BENCH_SECTION,
            "BENCH_MERGE_SOURCES": env.BENCH_MERGE_SOURCES,
            "BENCH_ENTRIES": env.BENCH_ENTRIES,
        },
        "mcp_plugins": plugin_list(mcp_env),
        "actions_plugins": plugin_list(actions_env),
        "workdir": str(WORKDIR),
    }
    (results_dir / "env.json").write_text(json.dumps(data, indent=2) + "\n")


def _print_header(
    run_id: str, scenarios: list[int], iterations: int, model: str,
) -> None:
    cli_ver = _run_quiet(["claude", "--version"]).split("\n")[0]
    commit = _run_quiet(
        ["git", "rev-parse", "--short", "HEAD"], cwd=PROJECT_DIR,
    ) or "unknown"
    scen_str = " ".join(str(s) for s in scenarios)
    typer.echo(f"=== Benchmark Run {run_id} ===")
    typer.echo(f"  Model: {model or 'default'}  CLI: {cli_ver}  Commit: {commit}")
    typer.echo(f"  Scenarios: {scen_str}  Iterations: {iterations}")


# ── Fixture reset & artifact cleanup ─────────────────────────────────────────

def _fixture_reset() -> None:
    try:
        subprocess.run(
            ["node", str(SCRIPT_DIR / "fixture-reset.mjs")],
            check=True, timeout=60,
            capture_output=True,
        )
    except Exception as e:
        typer.echo(f"  ⚠ fixture reset failed: {e}", err=True)


def _behavior_analysis(results_dir: Path) -> None:
    """Run analyze-behavior.mjs on NA sessions in results dir."""
    na_jsonls = sorted(results_dir.glob("nac-s*.jsonl"))
    if not na_jsonls:
        return
    typer.echo("\nRunning behavior analysis...")
    args = []
    for f in na_jsonls:
        args += ["--label", f.stem, str(f)]
    output_file = results_dir / "behavior.json"
    try:
        subprocess.run(
            ["node", str(SCRIPT_DIR / "analyze-behavior.mjs")] + args
            + ["--output", str(output_file)],
            check=True, timeout=60,
        )
    except Exception as e:
        typer.echo(f"  ⚠ behavior analysis failed: {e}", err=True)


VALIDATE_SCRIPT = SCRIPT_DIR / "validate-session.mjs"


def _validate_session(marker: str, scenario: int) -> dict:
    """Run validate-session.mjs and return the result dict."""
    if not VALIDATE_SCRIPT.exists():
        return {"valid": None, "reason": "validator not found"}
    try:
        out = subprocess.run(
            ["node", str(VALIDATE_SCRIPT), marker, str(scenario)],
            capture_output=True, text=True, timeout=60,
        )
        return json.loads(out.stdout.strip())
    except json.JSONDecodeError:
        return {"valid": False, "reason": f"validator output not JSON: {out.stdout[:200]}"}
    except subprocess.TimeoutExpired:
        return {"valid": False, "reason": "validator timed out"}
    except Exception as e:
        return {"valid": False, "reason": str(e)}


def _save_validation(label: str, result: dict, results_dir: Path) -> None:
    """Append a single validation result to validation.json."""
    vfile = results_dir / "validation.json"
    existing = {}
    if vfile.exists():
        try:
            existing = json.loads(vfile.read_text())
        except Exception:
            pass
    existing[label] = result
    vfile.write_text(json.dumps(existing, indent=2))


def _artifact_cleanup(run_id: str) -> None:
    cleanup_script = SCRIPT_DIR / "cleanup-artifacts.mjs"
    if not cleanup_script.exists():
        return
    try:
        subprocess.run(
            ["node", str(cleanup_script), run_id],
            check=True, timeout=60, capture_output=True,
        )
    except Exception as e:
        typer.echo(f"  ⚠ artifact cleanup failed: {e}", err=True)


# ── Scenario prompts ─────────────────────────────────────────────────────────

_skill_body_cache: str | None = None


def _load_skill_body() -> str:
    """Load SKILL.md body (after frontmatter) with resolved plugin root."""
    skill_path = PROJECT_DIR / "skills" / "notion-agent-cli" / "SKILL.md"
    text = skill_path.read_text()
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            text = text[end + 3:].strip()
    return text.replace("${CLAUDE_PLUGIN_ROOT}", str(PROJECT_DIR))


_bench_table_cache: str | None = None


def _load_bench_table() -> str:
    """Load the benchmark table fixture for S9/S10."""
    global _bench_table_cache
    if _bench_table_cache is None:
        _bench_table_cache = (PROJECT_DIR / "benchmark" / "fixtures" / "bench-table.md").read_text().strip()
    return _bench_table_cache


def _prompt_for(scenario: int, marker: str, prefix: str) -> str:
    global _skill_body_cache

    if prefix == "mcp":
        routing = "You MUST use Notion MCP tools. Do NOT use Bash or CLI scripts.\n\n"
    else:
        if _skill_body_cache is None:
            _skill_body_cache = _load_skill_body()
        routing = (
            "Use the notion-agent-cli CLI to complete this task. "
            "Do NOT use MCP tools. Do NOT read the script source.\n\n"
            f"{_skill_body_cache}\n\n"
        )

    P, PP, DB = env.BENCH_PAGE, env.BENCH_PARENT, env.BENCH_DB
    prompts = {
        1: (f'Read the Notion page {P} and create a new page titled "Summary [{marker}]" '
            f'under parent {PP}. The new page should contain a brief summary with at least '
            f'3 bullet points covering the main content of the source page.'),
        2: (f'Query the Notion database {DB} to get all entries, then create a new page '
            f'titled "Report [{marker}]" under parent {PP}. The report page should list '
            f'each database entry as a bullet point.'),
        3: (f'Read the Notion page {P}, then create a new page titled "Copy [{marker}]" '
            f'under parent {PP}. Copy the main content and add a new heading called '
            f'"Modifications" with a paragraph explaining what was changed.'),
        4: (f'Update the Notion database entry {env.BENCH_ENTRY}: set the "Benchmark Marker" '
            f'property to "{marker}".'),
        5: (f'In the Notion page {P}, replace the section under the heading '
            f'"{env.BENCH_SECTION}" with the following content: "This section was updated '
            f'by benchmark run {marker}. It contains a brief note and a bullet list:\n'
            f'- Item Alpha\n- Item Beta\n- Item Gamma"'),
        6: (f'Merge the following Notion pages into a single new page titled "Merged '
            f'[{marker}]" under parent {PP}. Source pages: '
            f'{env.BENCH_MERGE_SOURCES.replace(",", ", ")}. Combine all their content '
            f'into the new page, with each source page\'s content as a separate section.'),
        7: (f'Update the following Notion database entries: '
            f'{env.BENCH_ENTRIES.replace(",", ", ")}. Set the "Benchmark Marker" property to '
            f'"{marker}" on all of them.'),
        8: (f'Read the Notion page {P} and create a copy titled "Modified Copy [{marker}]" '
            f'under parent {PP}. The copy should contain all the original content plus a '
            f'new section at the end with heading "Benchmark Notes" and a paragraph: '
            f'"This copy was created by benchmark run {marker} with additional notes '
            f'appended."'),
        9: (f'Create a new Notion page titled "Table [{marker}]" under parent {PP}. '
            f'The page should contain the following data as a simple Notion table '
            f'(not a database, a table block). Preserve all rows and columns exactly.\n\n'
            f'{_load_bench_table()}'),
        10: (f'Create a new Notion database titled "DB [{marker}]" under parent {PP} '
             f'using the data below. Each row becomes a database entry. Infer appropriate '
             f'column types from the data (e.g., Year should be a number, Genre should be '
             f'a select, Rating should be a number). Preserve all 30 rows.\n\n'
             f'{_load_bench_table()}'),
    }

    required = {
        2: ("BENCH_DB", DB), 4: ("BENCH_ENTRY", env.BENCH_ENTRY),
        5: ("BENCH_SECTION", env.BENCH_SECTION),
        6: ("BENCH_MERGE_SOURCES", env.BENCH_MERGE_SOURCES),
        7: ("BENCH_ENTRIES", env.BENCH_ENTRIES),
    }
    if scenario in required:
        name, val = required[scenario]
        if not val:
            typer.echo(f"Error: {name} required for scenario {scenario}", err=True)
            raise typer.Exit(1)
    if scenario not in prompts:
        typer.echo(f"Error: unknown scenario {scenario} (valid: 1-10)", err=True)
        raise typer.Exit(1)

    return routing + prompts[scenario]


# ── Contamination check ─────────────────────────────────────────────────────

def _check_contamination(jsonl_path: Path, mode: str) -> bool:
    """Returns True if session is clean.

    Checks tool_use blocks for wrong-channel tools, not raw string search
    (page content may mention MCP/Bash without being contaminated).
    """
    try:
        text = jsonl_path.read_text()
    except OSError:
        return True
    if mode == "mcp":
        # MCP session should not invoke Bash tool
        return not re.search(r'"type"\s*:\s*"tool_use"[^}]*"name"\s*:\s*"Bash"', text)
    if mode == "nac":
        # NAC session should not invoke MCP tools (mcp__ prefix in tool_use name)
        return not re.search(r'"type"\s*:\s*"tool_use"[^}]*"name"\s*:\s*"mcp__', text)
    return True


def _contamination_summary(results_dir: Path) -> None:
    total = contaminated = 0
    for jsonl in sorted(results_dir.glob("*.jsonl")):
        total += 1
        mode = jsonl.stem.split("-")[0]
        if not _check_contamination(jsonl, mode):
            contaminated += 1
            typer.echo(f"  ⚠ CONTAMINATED: {jsonl.stem}")
    typer.echo(f"  Contamination: {contaminated}/{total} sessions")


# ── Session runner ───────────────────────────────────────────────────────────

@dataclass
class SessionResult:
    prefix: str
    scenario: int
    iteration: int
    marker: str
    outfile: Path
    skipped: bool = False
    turns: int | str = "?"
    cost: float | str = "?"

    def load(self) -> None:
        try:
            data = json.loads(self.outfile.read_text())
            self.turns = data.get("num_turns", "?")
            self.cost = data.get("total_cost_usd", "?")
        except Exception:
            self.turns = "?"
            self.cost = "FAILED"

    @property
    def label(self) -> str:
        return f"{self.prefix}-s{self.scenario}-{self.iteration}"

    def format_line(self, iterations: int) -> str:
        cost_str = f"${self.cost:.4f}" if isinstance(self.cost, float) else str(self.cost)
        if self.skipped:
            return f"  S{self.scenario:<2d} [{self.iteration}/{iterations}] {self.label:<16s}  SKIPPED ({self.turns}t)"
        return f"  S{self.scenario:<2d} [{self.iteration}/{iterations}] {self.label:<16s}  {self.turns}t  {cost_str}"


def _copy_jsonl(session_id: str, outfile: Path, prefix: str) -> None:
    """Find the JSONL session file in the bench HOME and copy it to results."""
    jsonlfile = outfile.with_suffix(".jsonl")
    bench_home = MCP_HOME if prefix == "mcp" else ACTIONS_HOME
    projects_dir = bench_home / ".claude" / "projects"

    found = None
    if projects_dir.is_dir():
        for p in projects_dir.rglob(f"{session_id}.jsonl"):
            found = p
            break

    if found:
        shutil.copy2(found, jsonlfile)
    else:
        typer.echo(f"  ⚠ JSONL not found for session {session_id}", err=True)
        jsonlfile.write_text(json.dumps({"error": "jsonl_missing", "session_id": session_id}))


def _run_session(
    prefix: str, scenario: int, iteration: int, *,
    run_id: str, results_dir: Path, model: str, iterations: int,
) -> SessionResult:
    """Run a single benchmark session."""
    marker = f"{prefix}-s{scenario}-{iteration}@{run_id}"
    outfile = results_dir / f"{prefix}-s{scenario}-{iteration}.json"
    result = SessionResult(prefix, scenario, iteration, marker, outfile)

    # Skip if valid output exists
    if outfile.exists():
        try:
            data = json.loads(outfile.read_text())
            if data.get("num_turns", 0) > 0:
                result.turns = data["num_turns"]
                result.cost = data.get("total_cost_usd", "?")
                result.skipped = True
                return result
        except Exception:
            pass

    session_id = str(uuid.uuid4())
    prompt = _prompt_for(scenario, marker, prefix)

    claude_cmd = str(SCRIPT_DIR / "envs" / ("claude-mcp" if prefix == "mcp" else "claude-actions"))
    cmd = [
        claude_cmd, "-p", prompt, "--dangerously-skip-permissions",
        "--output-format", "json", "--session-id", session_id,
    ]
    if model:
        cmd += ["--model", model]

    try:
        with open(outfile, "w") as f:
            subprocess.run(cmd, stdout=f, stderr=subprocess.DEVNULL, timeout=600)
    except subprocess.TimeoutExpired:
        typer.echo(f"  ⚠ session {marker} timed out (10min)", err=True)
    except Exception as e:
        typer.echo(f"  ⚠ session {marker} failed: {e}", err=True)

    _copy_jsonl(session_id, outfile, prefix)
    result.load()
    return result


def _run_plugin(
    prefix: str, label: str, *, scenarios: list[int],
    iterations: int, model: str, run_id: str, results_dir: Path,
) -> list[SessionResult]:
    """Run all sessions for a plugin (na or mcp). Always sequential.
    Returns list of SessionResult for validation."""
    parts = [f"S{','.join(str(s) for s in scenarios)}", f"n={iterations}"]
    if model:
        parts.append(f"model={model}")

    typer.echo(f"\n═══ {label} ({', '.join(parts)}) ═══")

    tasks = [(prefix, s, i) for s in scenarios for i in range(1, iterations + 1)]
    common = dict(run_id=run_id, results_dir=results_dir, model=model, iterations=iterations)
    results = []

    for prefix_, scenario, iteration in tasks:
        _fixture_reset()
        result = _run_session(prefix_, scenario, iteration, **common)
        line = result.format_line(iterations)
        # Validate immediately after each session
        if not result.skipped:
            v = _validate_session(result.marker, result.scenario)
            _save_validation(result.label, v, results_dir)
            status = "✓" if v.get("valid") else "✗"
            line += f"  {status}"
        typer.echo(line)
        results.append(result)

    return results


# ── Parse results (native Python) ───────────────────────────────────────────

@dataclass
class SessionSummary:
    name: str
    plugin: str
    scenario: int
    iteration: int
    turns: int
    cost: float


def _load_summaries(run_dir: Path, prefix_filter: str | None = None) -> list[SessionSummary]:
    """Load session summaries from .json files in a run directory."""
    results = []
    for json_file in sorted(run_dir.glob("*.json")):
        if json_file.name == "env.json" or json_file.name == "behavior.json":
            continue
        parts = json_file.stem.split("-")
        if len(parts) < 3:
            continue
        plugin = parts[0]
        if prefix_filter and plugin != prefix_filter:
            continue
        try:
            data = json.loads(json_file.read_text())
            turns = data.get("num_turns", 0)
            cost = data.get("total_cost_usd", 0.0)
            if turns < 2:
                continue
            scenario = int(parts[1][1:])
            iteration = int(parts[2])
            results.append(SessionSummary(json_file.stem, plugin, scenario, iteration, turns, cost))
        except (json.JSONDecodeError, ValueError, KeyError):
            continue
    return results


def _print_comparison_table(groups: dict[str, list[SessionSummary]]) -> None:
    """Print a compact comparison table: scenarios as rows, labels as columns."""
    labels = list(groups.keys())
    scenarios = sorted({s.scenario for sessions in groups.values() for s in sessions})

    # Header
    col_w = 24
    typer.echo(f"\n{'Scenario':<12s}" + "".join(f"{l:>{col_w}s}" for l in labels))
    typer.echo("─" * (12 + col_w * len(labels)))

    totals: dict[str, dict] = {l: {"turns": 0, "cost": 0.0, "n": 0} for l in labels}

    for s in scenarios:
        row = f"  S{s:<9d}"
        for label in labels:
            sessions = [x for x in groups[label] if x.scenario == s]
            if sessions:
                avg_t = sum(x.turns for x in sessions) / len(sessions)
                avg_c = sum(x.cost for x in sessions) / len(sessions)
                turns_str = ",".join(str(x.turns) for x in sessions)
                row += f"  {turns_str:>8s}t  ${avg_c:>7.4f}  "
                totals[label]["turns"] += sum(x.turns for x in sessions)
                totals[label]["cost"] += sum(x.cost for x in sessions)
                totals[label]["n"] += len(sessions)
            else:
                row += f"{'—':>{col_w}s}"
        typer.echo(row)

    # Totals
    typer.echo("─" * (12 + col_w * len(labels)))
    row = f"{'Total':<12s}"
    for label in labels:
        t = totals[label]
        if t["n"]:
            avg_t = t["turns"] / t["n"]
            row += f"  {'avg':>8s}={avg_t:.1f}t  ${t['cost']:>7.4f}  "
        else:
            row += f"{'—':>{col_w}s}"
    typer.echo(row)

    # Savings summary (if exactly 2 labels)
    if len(labels) == 2:
        a, b = labels
        ca, cb = totals[a]["cost"], totals[b]["cost"]
        if ca > 0 and cb > 0:
            if ca < cb:
                pct = (1 - ca / cb) * 100
                typer.echo(f"\n  {a} is {pct:.0f}% cheaper than {b} (${ca:.4f} vs ${cb:.4f})")
            else:
                pct = (1 - cb / ca) * 100
                typer.echo(f"\n  {b} is {pct:.0f}% cheaper than {a} (${cb:.4f} vs ${ca:.4f})")


def _resolve_run_dirs(run_ids: list[str]) -> list[Path]:
    """Resolve run IDs to result directories, or auto-detect latest."""
    if run_ids:
        dirs = []
        for rid in run_ids:
            d = RESULTS_BASE / rid
            if d.is_dir():
                dirs.append(d)
            else:
                typer.echo(f"  ⚠ run {rid} not found", err=True)
        return dirs

    # Auto-detect latest dirs with na and mcp sessions
    has_na = has_mcp = False
    dirs = []
    for d in sorted(RESULTS_BASE.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        found_na = any(d.glob("nac-s*.json"))
        found_mcp = any(d.glob("mcp-s*.json"))
        if found_na and not has_na:
            has_na = True
            dirs.append(d)
        if found_mcp and not has_mcp:
            has_mcp = True
            if d not in dirs:
                dirs.append(d)
        if has_na and has_mcp:
            break
    return sorted(dirs)


# ── Scenario spec parsing ────────────────────────────────────────────────────

def _parse_scenarios(spec: str) -> list[int]:
    """Parse '1-4,7,8' into sorted unique list [1,2,3,4,7,8]."""
    if not spec:
        return []
    result: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-", 1)
            result.update(range(int(lo), int(hi) + 1))
        else:
            result.add(int(part))
    return sorted(result)


# ── CLI Commands ─────────────────────────────────────────────────────────────

def _prepare_run(
    scenarios: str, iterations: int, model: str, run_id: list[str], clean: bool,
) -> tuple[list[int], str, Path]:
    """Common setup for run commands."""
    _load_env()
    _verify_bench_envs()

    scens = _parse_scenarios(scenarios) or list(range(1, 9))
    rid = run_id[0] if run_id else datetime.now().strftime("%Y%m%d-%H%M%S")
    results_dir = RESULTS_BASE / rid

    if clean and results_dir.is_dir():
        n = len(list(results_dir.iterdir()))
        typer.echo(f"  Removing {results_dir} ({n} files)...")
        shutil.rmtree(results_dir)

    results_dir.mkdir(parents=True, exist_ok=True)
    _print_header(rid, scens, iterations, model)
    return scens, rid, results_dir


# ── Shared options for all run commands ────────────────────────────────────────

_common_options = {
    "scenarios":  typer.Option("", "-s", "--scenarios", help='Scenarios: "1-10", "1,3,5"'),
    "iterations": typer.Option(3, "-n", "--iterations", help="Iterations per scenario"),
    "model":      typer.Option("", "-m", "--model", help="Claude model (e.g. claude-sonnet-4-6)"),
    "run_id":     typer.Option([], "-r", "--run-id", help="Custom run ID"),
    "clean":      typer.Option(False, help="Delete existing results first"),
    "cleanup":    typer.Option(True, help="Archive Notion artifacts after validation (--no-cleanup to keep)"),
}


def _run_benchmark(
    *, modes: list[str], scenarios: str, iterations: int,
    model: str, run_id: list[str], clean: bool, cleanup: bool,
) -> None:
    """Core benchmark pipeline. Modes: ["nac"], ["mcp"], or ["nac", "mcp"]."""
    labels = {"nac": "notion-agent-cli", "mcp": "MCP"}
    parsed_scenarios, rid, results_dir = _prepare_run(scenarios, iterations, model, run_id, clean)
    _reset_bench_homes()
    _write_env_json(
        results_dir, scenarios=parsed_scenarios,
        iterations=iterations, model=model, run_id=rid,
    )

    for mode in modes:
        _run_plugin(
            mode, labels[mode], scenarios=parsed_scenarios,
            iterations=iterations, model=model, run_id=rid, results_dir=results_dir,
        )
        if cleanup and mode != modes[-1]:
            _artifact_cleanup(rid)

    # Print validation summary
    vfile = results_dir / "validation.json"
    if vfile.exists():
        all_v = json.loads(vfile.read_text())
        passed = sum(1 for v in all_v.values() if v.get("valid") is True)
        failed = sum(1 for v in all_v.values() if v.get("valid") is False)
        typer.echo(f"\nValidation: {passed} passed, {failed} failed")

    _contamination_summary(results_dir)
    if "nac" in modes:
        _behavior_analysis(results_dir)

    if len(modes) > 1:
        groups = {m: _load_summaries(results_dir, m) for m in modes}
        _print_comparison_table(groups)

    if cleanup:
        _artifact_cleanup(rid)
    else:
        typer.echo("  Skipping artifact cleanup (--no-cleanup)")
    typer.echo(f"\nDone. Results: {results_dir}")


@app.command()
def actions(
    scenarios: str = _common_options["scenarios"],
    iterations: int = _common_options["iterations"],
    model: str = _common_options["model"],
    run_id: list[str] = _common_options["run_id"],
    clean: bool = _common_options["clean"],
    cleanup: bool = _common_options["cleanup"],
) -> None:
    """Run notion-agent-cli sessions only."""
    _run_benchmark(
        modes=["nac"], scenarios=scenarios, iterations=iterations,
        model=model, run_id=run_id, clean=clean, cleanup=cleanup,
    )


@app.command()
def mcp(
    scenarios: str = _common_options["scenarios"],
    iterations: int = _common_options["iterations"],
    model: str = _common_options["model"],
    run_id: list[str] = _common_options["run_id"],
    clean: bool = _common_options["clean"],
    cleanup: bool = _common_options["cleanup"],
) -> None:
    """Run MCP sessions only."""
    _run_benchmark(
        modes=["mcp"], scenarios=scenarios, iterations=iterations,
        model=model, run_id=run_id, clean=clean, cleanup=cleanup,
    )


@app.command(name="all")
def run_all(
    scenarios: str = _common_options["scenarios"],
    iterations: int = _common_options["iterations"],
    model: str = _common_options["model"],
    run_id: list[str] = _common_options["run_id"],
    clean: bool = _common_options["clean"],
    cleanup: bool = _common_options["cleanup"],
) -> None:
    """Run both notion-agent-cli and MCP sessions, then compare."""
    _run_benchmark(
        modes=["nac", "mcp"], scenarios=scenarios, iterations=iterations,
        model=model, run_id=run_id, clean=clean, cleanup=cleanup,
    )


@app.command()
def parse(
    run_id: list[str] = typer.Option([], "-r", "--run-id", help="Run ID(s) — auto-detect if omitted"),
    nac: str = typer.Option("", "--nac", help="Run ID for NAC sessions (explicit source)"),
    mcp_src: str = typer.Option("", "--mcp", help="Run ID for MCP sessions (explicit source)"),
    scenarios: str = typer.Option("", "-s", "--scenarios", help="Filter scenarios"),
) -> None:
    """Parse and compare results across runs.

    Examples:
      run.py parse                               # auto-detect latest
      run.py parse -r 20260315-004226            # single run
      run.py parse --nac 20260315-004226 --mcp 20260314-220209  # cross-run
    """
    scen_filter = set(_parse_scenarios(scenarios)) if scenarios else None

    # Explicit --nac / --mcp sources
    if nac or mcp_src:
        groups: dict[str, list[SessionSummary]] = {}
        sources = []
        if nac:
            d = RESULTS_BASE / nac
            if not d.is_dir():
                typer.echo(f"Error: run {nac} not found", err=True)
                raise typer.Exit(1)
            sessions = _load_summaries(d, "nac")
            if scen_filter:
                sessions = [s for s in sessions if s.scenario in scen_filter]
            groups["nac"] = sessions
            sources.append(f"nac: {nac}")
        if mcp_src:
            d = RESULTS_BASE / mcp_src
            if not d.is_dir():
                typer.echo(f"Error: run {mcp_src} not found", err=True)
                raise typer.Exit(1)
            sessions = _load_summaries(d, "mcp")
            if scen_filter:
                sessions = [s for s in sessions if s.scenario in scen_filter]
            groups["mcp"] = sessions
            sources.append(f"mcp: {mcp_src}")
        typer.echo(f"\n═══ Results ({', '.join(sources)}) ═══")
    else:
        # Auto-detect from -r flags or latest
        dirs = _resolve_run_dirs(run_id)
        if not dirs:
            typer.echo("Error: no result directories found", err=True)
            raise typer.Exit(1)

        typer.echo("\n═══ Results ═══")
        for d in dirs:
            n_na = len(list(d.glob("nac-s*.json")))
            n_mcp = len(list(d.glob("mcp-s*.json")))
            typer.echo(f"  {d.name}  ({n_na} nac, {n_mcp} mcp)")

        groups = {}
        for d in dirs:
            for prefix in ("nac", "mcp"):
                sessions = _load_summaries(d, prefix)
                if scen_filter:
                    sessions = [s for s in sessions if s.scenario in scen_filter]
                if sessions:
                    groups.setdefault(prefix, []).extend(sessions)

    groups = {k: v for k, v in groups.items() if v}
    if not groups:
        typer.echo("No sessions found.", err=True)
        raise typer.Exit(1)

    _print_comparison_table(groups)


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app()
