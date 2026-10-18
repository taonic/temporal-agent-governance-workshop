"""Environment-driven settings.

Only processes (workers, the stack, scripts) read the environment. Workflows never do: what a
workflow needs travels in its input or comes back from an activity, so a replay sees exactly
what the original run saw.
"""

import os
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path = ROOT / ".env") -> None:
    """Minimal .env support: KEY=value lines; real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.split(" #")[0].strip().strip('"').strip("'"))


_load_dotenv()


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _api_key() -> str:
    """For Gemini's OpenAI-compatible API, GEMINI_API_KEY if it's set (a generic LLM_API_KEY in
    your shell is often another project's); otherwise LLM_API_KEY. A Gemini key is only ever sent
    to Gemini's endpoint."""
    if "generativelanguage.googleapis.com" in _env("LLM_BASE_URL", "") and os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    return _env("LLM_API_KEY", "unused")


@dataclass(frozen=True)
class Settings:
    temporal_address: str = field(default_factory=lambda: _env("TEMPORAL_ADDRESS", "localhost:7233"))
    temporal_namespace: str = field(default_factory=lambda: _env("TEMPORAL_NAMESPACE", "default"))
    task_queue: str = field(default_factory=lambda: _env("TASK_QUEUE", "travel-agent"))
    temporal_ui_url: str = field(default_factory=lambda: _env("TEMPORAL_UI_URL", "http://localhost:8233"))

    # The model: "openai" talks to any OpenAI-compatible endpoint (the shared GPU, by default);
    # "scripted" plays a fixed travel agent so checks and offline runs are deterministic.
    llm_mode: str = field(default_factory=lambda: _env("LLM_MODE", "openai"))
    llm_base_url: str = field(default_factory=lambda: _env("LLM_BASE_URL", "http://localhost:11434/v1"))
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL", "qwen3.5-9b"))
    llm_api_key: str = field(default_factory=lambda: _api_key())
    llm_reasoning_effort: str = field(default_factory=lambda: _env("LLM_REASONING_EFFORT", ""))

    # How long the simulated travel APIs take to answer, in seconds. Long enough to watch a
    # search happen; the checks set it to 0.
    tool_latency_s: float = field(default_factory=lambda: float(_env("TOOL_LATENCY_S", "1.5")))

    # Dogwood: the CLI (exercise 4 check) and the verifier (`travel-stack up`), built by
    # scripts/setup_dogwood.sh.
    dogwood_cli: Path = field(default_factory=lambda: Path(_env("DOGWOOD_CLI", str(ROOT / ".dogwood/bin/dogwood"))))
    dogwood_verifier: Path = field(
        default_factory=lambda: Path(_env("DOGWOOD_VERIFIER", str(ROOT / ".dogwood/bin/dogwood-verifier")))
    )
    policy_dir: Path = field(default_factory=lambda: Path(_env("POLICY_DIR", str(ROOT / "policies"))))


settings = Settings()


def session_id() -> str:
    """A new session's workflow id, named for the exercise you're on, so it's easy to find in the
    Temporal UI: ``ex3-human-approval-1a2b3c4d``. The exercise is in .course/exercise (the browser
    course and the exercises' setup scripts write it); without one, ``travel-1a2b3c4d``."""
    try:
        exercise = (ROOT / ".course" / "exercise").read_text().strip()
    except OSError:
        exercise = ""
    match = re.fullmatch(r"0*(\d+)-([a-z0-9-]+)", exercise)
    prefix = f"ex{match[1]}-{match[2]}" if match else "travel"
    return f"{prefix}-{uuid.uuid4().hex[:8]}"
