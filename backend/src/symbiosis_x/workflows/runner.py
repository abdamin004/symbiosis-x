"""Dispatch one agent tool call through the registry's permission check.

The runner returns a typed result and never writes plant state. A denied call
carries a reason code and no intents, so it cannot produce a plant effect.
"""

from dataclasses import dataclass, field
from typing import Literal

from symbiosis_x.workflows.tools import ToolIntent, ToolRegistry

ResultStatus = Literal["accepted", "denied"]
ReasonCode = Literal["UNKNOWN_TOOL", "AGENT_NOT_ALLOWED", "TRIGGER_NOT_ALLOWED", "INVALID_REQUEST"]


@dataclass(frozen=True)
class ToolCall:
    agent: str
    tool: str
    trigger_key: str
    trigger_event_id: str
    mission_s: int
    args: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolResult:
    status: ResultStatus
    agent: str
    tool: str
    trigger_event_id: str
    reason_code: ReasonCode | None = None
    intents: tuple[ToolIntent, ...] = ()


def dispatch(registry: ToolRegistry, call: ToolCall) -> ToolResult:
    """Check the tool, agent, trigger and arguments, then return an advisory intent."""
    spec = registry.get(call.tool)
    if spec is None:
        return _denied(call, "UNKNOWN_TOOL")
    if call.agent not in spec.allowed_agents:
        return _denied(call, "AGENT_NOT_ALLOWED")
    if call.trigger_key not in spec.trigger_keys:
        return _denied(call, "TRIGGER_NOT_ALLOWED")
    if (
        not call.trigger_event_id
        or type(call.mission_s) is not int
        or call.mission_s < 0
        or set(call.args) != spec.arg_names
        or not all(isinstance(value, str) and value for value in call.args.values())
    ):
        return _denied(call, "INVALID_REQUEST")

    intent = ToolIntent(
        kind=spec.kind,
        tool=spec.name,
        agent=call.agent,
        owner=spec.owner,
        trigger_key=call.trigger_key,
        trigger_event_id=call.trigger_event_id,
        mission_s=call.mission_s,
        args=dict(call.args),
        dedup_key=f"{call.agent}:{spec.name}:{call.trigger_event_id}",
    )
    return ToolResult("accepted", call.agent, call.tool, call.trigger_event_id, intents=(intent,))


def _denied(call: ToolCall, reason_code: ReasonCode) -> ToolResult:
    return ToolResult("denied", call.agent, call.tool, call.trigger_event_id, reason_code)
