"""Verify the agent dispatcher allows only registered tools and never touches the plant."""

import json
import sys
from copy import deepcopy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from symbiosis_x.workflows.runner import ToolCall, dispatch
from symbiosis_x.workflows.tools import ToolIntent, ToolRegistry, ToolSpec, default_registry


@pytest.fixture
def plant():
    """Use the published Crew v103 equipment as the current simulated plant."""
    example = json.loads((ROOT / "contracts/examples/crew-v103.json").read_text())
    return example["equipment"]


def inspection_call(**changes):
    call = {
        "agent": "monitor",
        "tool": "assign_inspection",
        "trigger_key": "observation.recorded",
        "trigger_event_id": "sim.cabin.co2:780",
        "mission_s": 780,
        "args": {"entity_id": "cabin-01"},
    }
    call.update(changes)
    return ToolCall(**call)


@pytest.mark.parametrize(
    ("changes", "reason_code"),
    [
        ({"tool": "set_scrubber_flow"}, "UNKNOWN_TOOL"),
        ({"agent": "planner"}, "AGENT_NOT_ALLOWED"),
        ({"trigger_key": "advice.received"}, "TRIGGER_NOT_ALLOWED"),
    ],
)
def test_denied_tool_has_no_plant_effect(plant, changes, reason_code):
    before = deepcopy(plant)

    result = dispatch(default_registry(), inspection_call(**changes))

    assert result.status == "denied"
    assert result.reason_code == reason_code
    assert result.intents == ()
    assert plant == before


def test_allowed_tool_returns_one_typed_intent(plant):
    before = deepcopy(plant)

    result = dispatch(default_registry(), inspection_call())

    assert result.status == "accepted"
    assert result.reason_code is None
    assert result.intents == (
        ToolIntent(
            kind="assign_inspection",
            tool="assign_inspection",
            agent="monitor",
            owner="crew",
            trigger_key="observation.recorded",
            trigger_event_id="sim.cabin.co2:780",
            mission_s=780,
            args={"entity_id": "cabin-01"},
            dedup_key="monitor:assign_inspection:sim.cabin.co2:780",
        ),
    )
    assert plant == before


def test_intent_keeps_its_own_copy_of_args():
    args = {"entity_id": "cabin-01"}
    result = dispatch(default_registry(), inspection_call(args=args))
    args["entity_id"] = "power-bus"

    assert result.intents[0].args == {"entity_id": "cabin-01"}


@pytest.mark.parametrize(
    "changes",
    [
        {"trigger_event_id": ""},
        {"mission_s": -1},
        {"mission_s": 780.0},
        {"args": {}},
        {"args": {"entity_id": "cabin-01", "flow_m3_h": 0}},
        {"args": {"entity_id": ""}},
    ],
)
def test_malformed_call_is_denied_with_reason(changes):
    result = dispatch(default_registry(), inspection_call(**changes))

    assert result.status == "denied"
    assert result.reason_code == "INVALID_REQUEST"
    assert result.intents == ()


def test_registry_refuses_a_plant_write_tool():
    with pytest.raises(ValueError, match="intent kind"):
        ToolSpec(
            name="set_scrubber_flow",
            kind="plant_command",
            allowed_agents=frozenset({"monitor"}),
            trigger_keys=frozenset({"observation.recorded"}),
            arg_names=frozenset({"flow_m3_h"}),
            owner="crew",
        )


def test_registry_refuses_duplicate_tool_names():
    registry = default_registry()
    with pytest.raises(ValueError, match="already registered"):
        registry.register(registry.get("assign_inspection"))


def test_empty_registry_denies_every_tool():
    result = dispatch(ToolRegistry(), inspection_call())

    assert (result.status, result.reason_code, result.intents) == ("denied", "UNKNOWN_TOOL", ())
