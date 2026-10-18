"""Write the Dogwood action schema for the travel agent to ``policies/schema.cedarschema``.

    uv run python -m travel_agent.schema

Run it after changing the agent's tools or messages. The verifier and the `dogwood` CLI check
``policies/travel.dw`` against the schema, so a policy that names a tool or field the agent
doesn't have is rejected, rather than silently never matching.
"""

from temporal_agent_harness.harness.dogwood_approvals.schema import dogwood_schema

from .agent.trip_form import ask_trip_details
from .agent.workflow import ACTION_PREFIX, TravelAgentWorkflow, build_code_tool
from .config import settings
from .travel import activities

SCHEMA_FILE = settings.policy_dir / "schema.cedarschema"


def render() -> str:
    """The script tool, the trip form, each travel tool a script's host calls reach the policy
    as, their results, and the agent's messages. The board and file tools are pre-approved and
    no policy reads their results, so they're left out."""
    return dogwood_schema(
        [build_code_tool(), ask_trip_details, *activities.ALL_TOOLS],
        action_prefix=ACTION_PREFIX,
        agent_class=TravelAgentWorkflow,
    )


if __name__ == "__main__":
    SCHEMA_FILE.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_FILE.write_text(render())
    print(f"wrote {SCHEMA_FILE}")
