"""Deterministic, per-vehicle synthetic water and meal ledger.

This model is deliberately independent of Crew medical records and the live
plant command gate.  Adapters must authorize an operation before calling it.
Every accepted and held request gets a stable, idempotent receipt.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal

Action = Literal["drink", "meal", "hygiene", "oxygen", "treat", "release", "reject", "resupply", "ration"]
Priority = Literal["essential", "optional"]
Ration = Literal["standard", "conserve", "emergency"]


@dataclass(frozen=True)
class WaterCommand:
    operation_id: str
    action: Action
    amount_l: float = 0.0
    priority: Priority = "essential"
    quality_verified: bool = False
    station_receipt: str | None = None
    commander_approved: bool = False
    ration: Ration | None = None


@dataclass(frozen=True)
class WaterReceipt:
    operation_id: str
    action: Action
    status: Literal["accepted", "held"]
    reason_code: str | None
    potable_delta_l: float
    wastewater_delta_l: float
    pending_delta_l: float
    meal_delta: int
    power_delta_kwh: float
    request: WaterCommand


@dataclass(frozen=True)
class WaterInventory:
    vehicle_id: str
    potable_l: float
    protected_reserve_l: float
    wastewater_l: float
    pending_treatment_l: float
    rejected_l: float
    exported_l: float
    meal_packs: int
    power_kwh: float
    ration_mode: Ration = "standard"
    receipts: tuple[WaterReceipt, ...] = ()

    def __post_init__(self) -> None:
        fields = (
            self.potable_l, self.protected_reserve_l, self.wastewater_l,
            self.pending_treatment_l, self.rejected_l, self.exported_l, self.power_kwh,
        )
        if not self.vehicle_id or not all(0 <= value < float("inf") for value in fields):
            raise ValueError("INVALID_WATER_INVENTORY")
        if not isinstance(self.meal_packs, int) or self.meal_packs < 0:
            raise ValueError("INVALID_MEAL_INVENTORY")

    @property
    def accounted_water_l(self) -> float:
        return round(
            self.potable_l + self.wastewater_l + self.pending_treatment_l
            + self.rejected_l + self.exported_l, 6,
        )

    def apply(self, command: WaterCommand) -> tuple[WaterInventory, WaterReceipt]:
        if not command.operation_id:
            raise ValueError("OPERATION_ID_REQUIRED")
        prior = next((r for r in self.receipts if r.operation_id == command.operation_id), None)
        if prior:
            if prior.request != command:
                raise ValueError("OPERATION_ID_REUSED")
            return self, prior
        if not 0 <= command.amount_l < float("inf"):
            raise ValueError("INVALID_WATER_AMOUNT")
        reason = None
        potable = self.potable_l
        wastewater = self.wastewater_l
        pending = self.pending_treatment_l
        rejected = self.rejected_l
        exported = self.exported_l
        meals = self.meal_packs
        power = self.power_kwh
        ration = self.ration_mode
        amount = command.amount_l
        cost = 0.0

        if command.action == "ration":
            if not command.commander_approved or command.ration is None:
                reason = "COMMANDER_AUTHORIZATION_REQUIRED"
            else:
                ration = command.ration
        elif command.action == "resupply":
            if not command.station_receipt or not command.commander_approved:
                reason = "VERIFIED_RESUPPLY_RECEIPT_REQUIRED"
            elif amount <= 0:
                reason = "INVALID_RESUPPLY"
            else:
                potable += amount
        elif command.action in ("release", "reject"):
            if not command.quality_verified:
                reason = "QUALITY_NOT_VERIFIED"
            elif amount <= 0 or amount > pending:
                reason = "PENDING_WATER_UNAVAILABLE"
            else:
                pending -= amount
                if command.action == "release":
                    potable += amount
                else:
                    rejected += amount
        elif command.action == "treat":
            cost = round(amount * 0.12, 6)
            if amount <= 0 or amount > wastewater:
                reason = "WASTEWATER_UNAVAILABLE"
            elif power < cost:
                reason = "POWER_UNAVAILABLE"
            else:
                wastewater -= amount
                pending += amount
                power -= cost
        else:
            if command.action not in ("drink", "meal", "hygiene", "oxygen"):
                raise ValueError("UNKNOWN_WATER_ACTION")
            required = {
                "drink": 0.25, "meal": 0.15, "hygiene": 0.5, "oxygen": 0.2,
            }[command.action]
            cost = {"drink": 0.0, "meal": 0.05, "hygiene": 0.08, "oxygen": 0.12}[command.action]
            if amount not in (0.0, required):
                reason = "INVALID_ACTION_VOLUME"
            elif command.priority == "optional" and ration != "standard":
                reason = "RATION_PRIORITY_HOLD"
            elif potable < required:
                reason = "POTABLE_SHORTAGE"
            elif command.priority == "optional" and potable - required < self.protected_reserve_l:
                reason = "PROTECTED_RESERVE"
            elif power < cost:
                reason = "POWER_UNAVAILABLE"
            elif command.action == "meal" and meals <= 0:
                reason = "MEAL_SHORTAGE"
            else:
                potable -= required
                power -= cost
                if command.action == "oxygen":
                    exported += required
                else:
                    wastewater += required
                if command.action == "meal":
                    meals -= 1

        good = reason is None
        receipt = WaterReceipt(
            operation_id=command.operation_id, action=command.action,
            status="accepted" if good else "held", reason_code=reason,
            potable_delta_l=round(potable - self.potable_l, 6),
            wastewater_delta_l=round(wastewater - self.wastewater_l, 6),
            pending_delta_l=round(pending - self.pending_treatment_l, 6),
            meal_delta=meals - self.meal_packs,
            power_delta_kwh=round(power - self.power_kwh, 6),
            request=command,
        )
        state = replace(
            self, potable_l=round(potable, 6), wastewater_l=round(wastewater, 6),
            pending_treatment_l=round(pending, 6), rejected_l=round(rejected, 6),
            exported_l=round(exported, 6), meal_packs=meals,
            power_kwh=round(power, 6), ration_mode=ration,
            receipts=(*self.receipts, receipt),
        )
        return state, receipt
