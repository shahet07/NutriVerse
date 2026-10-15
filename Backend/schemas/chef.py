from __future__ import annotations

from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


# ── Chef Parse (existing) ──────────────────────────────────────────


class ChefParseRequest(BaseModel):
    recipe_name: str = Field(..., min_length=1, description="Name of the dish")
    instructions: Optional[str] = Field(
        None,
        description="Raw cooking instructions text. If not provided, the AI will generate steps from the dish name and ingredients.",
    )
    ingredients: Optional[str] = Field(None, description="Raw ingredients list (optional)")


class MiseEnPlaceItem(BaseModel):
    id: int
    text: str
    duration_minutes: Optional[int] = None


class CookStep(BaseModel):
    id: int
    action: str
    timer_seconds: Optional[int] = None
    tool: Optional[str] = None
    tip: Optional[str] = None


class ChefParseResponse(BaseModel):
    recipe_name: str
    mise_en_place: List[MiseEnPlaceItem] = Field(default_factory=list)
    steps: List[CookStep] = Field(default_factory=list)
    tools_required: List[str] = Field(default_factory=list)
    estimated_total_minutes: Optional[int] = None
    parse_error: Optional[str] = None


# ── Voice Intent (P2P Kitchen Remote) ──────────────────────────────


class VoiceAction(str, Enum):
    """Actions the voice command can resolve to."""

    NEXT = "NEXT"
    PREV = "PREV"
    DONE = "DONE"
    STRIKE = "STRIKE"
    STRIKE_PREP = "STRIKE_PREP"
    TIMER_START = "TIMER_START"
    TIMER_PAUSE = "TIMER_PAUSE"
    TIMER_RESET = "TIMER_RESET"
    REPEAT = "REPEAT"
    ASK = "ASK"
    NOOP = "NOOP"
    START_COOKING = "START_COOKING"
    FINISH_SESSION = "FINISH_SESSION"


class ChefIntentRequest(BaseModel):
    """Raw voice transcript + cooking context sent from the PC frontend."""

    raw_text: str = Field(..., min_length=1, description="Raw speech-to-text transcript from the phone")
    recipe_name: str = Field(..., min_length=1, description="Name of the dish being cooked")
    current_step: int = Field(..., ge=1, description="1-based index of the current cooking step")
    total_steps: int = Field(..., ge=1, description="Total number of cooking steps")
    current_action: str = Field(..., description="Text of the current cooking step")
    timer_running: bool = Field(False, description="Whether the step timer is currently running")
    timer_seconds_left: Optional[int] = Field(None, description="Seconds remaining on the timer, if any")
    phase: str = Field("cooking", description="Current cooking phase: prep | cooking | done")
    mise_en_place: List[str] = Field(default_factory=list, description="List of prep task descriptions for fuzzy matching")


class ChefIntentResponse(BaseModel):
    """Structured intent parsed from voice command."""

    action: VoiceAction = Field(..., description="The resolved action to take")
    step: Optional[int] = Field(None, description="Target step number (1-based), for STRIKE action")
    question: Optional[str] = Field(None, description="Question text if action is ASK")
    confidence: float = Field(1.0, ge=0.0, le=1.0, description="Confidence in the parsed intent")
    filtered: bool = Field(False, description="True if the text was filtered out as non-cooking noise")
    prep_item: Optional[str] = Field(None, description="Matched prep item text for STRIKE_PREP action")
    display_text: Optional[str] = Field(None, description="Human-readable confirmation message for the UI chat")


class CookingSessionState(BaseModel):
    """Full cooking session state pushed from PC to phone over WebRTC."""

    recipe_name: str
    current_step: int  # 1-based
    total_steps: int
    current_action: str
    current_tool: Optional[str] = None
    current_tip: Optional[str] = None
    timer_total: Optional[int] = None
    timer_left: Optional[int] = None
    timer_running: bool = False
    completed_steps: List[int] = Field(default_factory=list)
    phase: str = "cooking"  # "prep" | "cooking" | "done"
    steps_overview: List[Dict[str, str]] = Field(
        default_factory=list,
        description="Compact list of {id, action, completed} for all steps",
    )
