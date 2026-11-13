"""Deterministic inventory rules for the synthetic Flight game."""

from dataclasses import dataclass, replace
from typing import Literal

from symbiosis_x.simulation.spacecraft.electrical import check_standby_power

Vehicle = Literal["asteria", "kestrel", "return-capsule"]
Action = Literal[
    "drink", "prepare_meal", "hygiene", "oxygen_generation", "release_reserve",
    "treat", "verify", "reject", "replenish",
]
Ration = Literal["standard", "conserve"]
Activity = Literal["rest", "routine", "working"]

VEHICLE_STORES: dict[Vehicle, tuple[int, int, int]] = {
    "asteria": (24_000, 6_000, 40),
    "kestrel": (12_000, 3_000, 20),
    "return-capsule": (6_000, 2_000, 8),
}
# Fictional training parameters, expressed in mL, kW, and whole meal packs.
DRINK_ML: dict[Activity, int] = {"rest": 180, "routine": 250, "working": 320}
MEAL_ML: dict[Ration, int] = {"standard": 180, "conserve": 125}
HYGIENE_ML = 300
HYGIENE_WASTE_ML = 260
TREATMENT_YIELD_PERCENT = 80

LOAD_KW: dict[Action, float] = {
    "prepare_meal": 0.12, "hygiene": 0.03, "oxygen_generation": 0.25, "treat": 0.18,
}


@dataclass(frozen=True)
class Inventory:
    vehicle: Vehicle
    potable_ml: int
    reserve_ml: int
    meals: int
    wastewater_ml: int = 0
    held_ml: int = 0
    rejected_ml: int = 0
    used_ml: int = 0

    @classmethod
    def loaded_on_earth(cls, vehicle: Vehicle) -> "Inventory":
        return cls(vehicle, *VEHICLE_STORES[vehicle])

    @property
    def accounted_water_ml(self) -> int:
        return (
            self.potable_ml + self.reserve_ml + self.wastewater_ml
            + self.held_ml + self.rejected_ml + self.used_ml
        )


@dataclass(frozen=True)
class Operation:
    operation_id: str
    mission_s: int
    action: Action
    activity: Activity = "routine"
    ration: Ration = "standard"
    volume_ml: int = 0
    transfer_receipt: str | None = None


@dataclass(frozen=True)
class Evidence:
    served_kw: float | None = None
    station_transfer_authorized: bool = False
    processor_available: bool = False
    passed_quality_check: bool = False


@dataclass(frozen=True)
class Receipt:
    operation: Operation
    applied: bool
    reason: str


@dataclass(frozen=True)
class Ledger:
    stock: Inventory
    receipts: tuple[Receipt, ...] = ()

    def commit(self, order: Operation, evidence: Evidence = Evidence()) -> tuple["Ledger", Receipt]:
        if not order.operation_id or order.mission_s < 0:
            raise ValueError("A provision operation needs an ID and a nonnegative mission time")
        if type(order.volume_ml) is not int or order.volume_ml < 0:
            raise ValueError("Volume must be a nonnegative whole number of mL")
        previous = next((receipt for receipt in self.receipts
                         if receipt.operation.operation_id == order.operation_id), None)
        if previous is not None:
            if previous.operation != order:
                raise ValueError("The operation ID already identifies a different provision command")
            return self, previous
        if self.receipts and order.mission_s < self.receipts[-1].operation.mission_s:
            raise ValueError("Provision receipts must follow mission time")
        stock, reason = self._apply(order, evidence)
        receipt = Receipt(order, stock is not None, reason)
        return Ledger(stock or self.stock, (*self.receipts, receipt)), receipt

    def _apply(self, order: Operation, evidence: Evidence) -> tuple[Inventory | None, str]:
        action = order.action
        demand = LOAD_KW.get(action)
        if demand is not None:
            power = check_standby_power(evidence.served_kw, demand)
            if power.outcome != "ready":
                return None, power.reason_code or "POWER_UNAVAILABLE"

        if action in ("drink", "prepare_meal", "hygiene", "oxygen_generation"):
            return self._consume(order)

        stock = self.stock
        amount = order.volume_ml
        if not amount:
            return None, "VOLUME_REQUIRED"
        if action == "release_reserve":
            if amount > stock.reserve_ml:
                return None, "RESERVE_SHORT"
            return replace(stock, reserve_ml=stock.reserve_ml-amount,
                           potable_ml=stock.potable_ml+amount), "RESERVE_RELEASED"
        if action == "treat":
            if not evidence.processor_available:
                return None, "PROCESSOR_UNAVAILABLE"
            if amount > stock.wastewater_ml:
                return None, "WASTEWATER_SHORT"
            product = amount * TREATMENT_YIELD_PERCENT // 100
            return replace(stock, wastewater_ml=stock.wastewater_ml-amount,
                           held_ml=stock.held_ml+product,
                           rejected_ml=stock.rejected_ml+amount-product), "QUALITY_HOLD"
        if action in ("verify", "reject"):
            if amount > stock.held_ml:
                return None, "PRODUCT_SHORT"
            if action == "reject":
                return replace(stock, held_ml=stock.held_ml-amount,
                               rejected_ml=stock.rejected_ml+amount), "PRODUCT_REJECTED"
            if not evidence.passed_quality_check:
                return None, "QUALITY_EVIDENCE_REQUIRED"
            return replace(stock, held_ml=stock.held_ml-amount,
                           potable_ml=stock.potable_ml+amount), "PRODUCT_RELEASED"
        if action == "replenish":
            if not evidence.station_transfer_authorized or not order.transfer_receipt:
                return None, "TRANSFER_RECEIPT_REQUIRED"
            if any(receipt.applied and receipt.operation.action == "replenish"
                   and receipt.operation.transfer_receipt == order.transfer_receipt
                   for receipt in self.receipts):
                return None, "TRANSFER_ALREADY_ACCEPTED"
            return replace(stock, potable_ml=stock.potable_ml+amount), "TRANSFER_ACCEPTED"
        raise ValueError(f"Unknown provision action {action!r}")

    def _consume(self, order: Operation) -> tuple[Inventory | None, str]:
        stock = self.stock
        action = order.action
        conserving = order.ration == "conserve"
        if action == "hygiene" and conserving:
            return None, "HYGIENE_DEFERRED_BY_RATION"
        if action == "prepare_meal" and stock.meals == 0:
            return None, "MEALS_SHORT"

        if action == "drink":
            amount = DRINK_ML[order.activity]
            returned = amount // 2
        elif action == "prepare_meal":
            amount = MEAL_ML[order.ration]
            returned = 0
        elif action == "hygiene":
            amount = HYGIENE_ML
            returned = HYGIENE_WASTE_ML
        else:
            amount = order.volume_ml
            returned = 0
            if not amount:
                return None, "VOLUME_REQUIRED"
        if stock.potable_ml < amount:
            return None, "POTABLE_SHORT"
        return replace(
            stock, potable_ml=stock.potable_ml-amount, wastewater_ml=stock.wastewater_ml+returned,
            used_ml=stock.used_ml+amount-returned, meals=stock.meals-int(action == "prepare_meal"),
        ), "CONSUMED"


def flight_rules() -> dict:
    """Export fixed training parameters for the standalone Flight ledger."""
    return {
        "stores": VEHICLE_STORES,
        "drink_ml": DRINK_ML,
        "load_kw": LOAD_KW,
        "meal_ml": MEAL_ML,
        "hygiene_ml": HYGIENE_ML,
        "hygiene_waste_ml": HYGIENE_WASTE_ML,
        "treatment_yield_percent": TREATMENT_YIELD_PERCENT,
        "transfer_ml": 750,
    }
