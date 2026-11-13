"""Register agent tools with explicit allowlists and typed, advisory intents.

Agents never receive a plant write tool. A tool can only produce an intent of an
advisory kind, and the application writer decides what, if anything, to record.
"""

from dataclasses import dataclass
from typing import Literal

AgentName = Literal["monitor", "planner", "relay"]
IntentKind = Literal["assign_inspection", "queue_message", "request_evaluation"]

AGENTS: frozenset[str] = frozenset({"monitor", "planner", "relay"})
INTENT_KINDS: frozenset[str] = frozenset({"assign_inspection", "queue_message", "request_evaluation"})


@dataclass(frozen=True)
class ToolSpec:
    name: str
    kind: IntentKind
    allowed_agents: frozenset[str]
    trigger_keys: frozenset[str]
    arg_names: frozenset[str]
    owner: str

    def __post_init__(self) -> None:
        if not self.name or not self.owner:
            raise ValueError("a tool requires a name and a next owner")
        if self.kind not in INTENT_KINDS:
            raise ValueError(f"tool {self.name!r} has a non-advisory intent kind {self.kind!r}")
        if not self.allowed_agents or not self.allowed_agents <= AGENTS:
            raise ValueError(f"tool {self.name!r} must allow only known agents")
        if not self.trigger_keys or not all(self.trigger_keys):
            raise ValueError(f"tool {self.name!r} requires at least one trigger key")


@dataclass(frozen=True)
class ToolIntent:
    """An advisory request for the application writer. It carries its evidence and owner."""

    kind: IntentKind
    tool: str
    agent: str
    owner: str
    trigger_key: str
    trigger_event_id: str
    mission_s: int
    args: dict[str, str]
    dedup_key: str


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValueError(f"tool {spec.name!r} is already registered")
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)


FAULT_TRIGGERS = frozenset({"fault.scrubber_degraded", "fault.power_drop"})


def default_registry() -> ToolRegistry:
    """Monitor may assign a Crew inspection on an observation, or ask the planner to evaluate a fault."""
    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="assign_inspection",
            kind="assign_inspection",
            allowed_agents=frozenset({"monitor"}),
            trigger_keys=frozenset({"observation.recorded"}),
            arg_names=frozenset({"entity_id"}),
            owner="crew",
        )
    )
    registry.register(
        ToolSpec(
            name="request_plan_evaluation",
            kind="request_evaluation",
            allowed_agents=frozenset({"monitor"}),
            trigger_keys=FAULT_TRIGGERS,
            arg_names=frozenset({"component_id"}),
            owner="planner",
        )
    )
    return registry
