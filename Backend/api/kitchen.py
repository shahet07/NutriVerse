from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from Backend.schemas.chef import (
    ChefIntentRequest,
    ChefIntentResponse,
    VoiceAction,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Kitchen"])


# ══════════════════════════════════════════════════════════════════════
#  Server-Side Cooking Session
# ══════════════════════════════════════════════════════════════════════


class CookingSession:
    """Manages a single cooking session's mutable state on the server.

    The phone sends the parsed recipe once (via ``init-session``).
    All voice commands mutate this object, and the full state is pushed
    back to the phone after every mutation.
    """

    def __init__(self, data: dict[str, Any]) -> None:
        self.recipe_name: str = data.get("recipe_name", "Unknown")
        self.mise_en_place: list[dict[str, Any]] = [
            {"id": m.get("id", i + 1), "text": m.get("text", ""), "done": False,
             "duration_minutes": m.get("duration_minutes")}
            for i, m in enumerate(data.get("mise_en_place", []))
        ]
        self.steps: list[dict[str, Any]] = []
        for i, s in enumerate(data.get("steps", [])):
            self.steps.append({
                "id": s.get("id", i + 1),
                "action": s.get("action", ""),
                "timer_seconds": s.get("timer_seconds"),
                "tool": s.get("tool"),
                "tip": s.get("tip"),
                "completed": False,
            })
        self.tools_required: list[str] = data.get("tools_required", [])
        self.estimated_total_minutes: int | None = data.get("estimated_total_minutes")
        self.current_step: int = 1
        self.phase: str = "prep" if self.mise_en_place else "cooking"
        self.timer_total: int | None = None
        self.timer_left: int | None = None
        self.timer_running: bool = False
        self._timer_started_at: float | None = None
        self.chat_messages: list[dict[str, str]] = []

        # Initialize timer for step 1 if in cooking phase
        if self.phase == "cooking" and self.steps:
            self._set_timer_for_step(1)

    def _set_timer_for_step(self, step_num: int) -> None:
        idx = step_num - 1
        if 0 <= idx < len(self.steps):
            ts = self.steps[idx].get("timer_seconds")
            if ts and isinstance(ts, (int, float)) and ts > 0:
                self.timer_total = int(ts)
                self.timer_left = int(ts)
            else:
                self.timer_total = None
                self.timer_left = None
            self.timer_running = False
            self._timer_started_at = None

    def _sync_timer(self) -> None:
        """Update timer_left based on elapsed wall-clock time."""
        if self.timer_running and self._timer_started_at and self.timer_left is not None:
            elapsed = time.monotonic() - self._timer_started_at
            self.timer_left = max(0, int(self.timer_total or 0) - int(elapsed))
            if self.timer_left <= 0:
                self.timer_left = 0
                self.timer_running = False
                self._timer_started_at = None

    # ── Actions ─────────────────────────────────────────────────────

    def next_step(self) -> str:
        if self.current_step < len(self.steps):
            self.current_step += 1
            self._set_timer_for_step(self.current_step)
            return f"Moving to step {self.current_step}"
        return "Already on the last step"

    def prev_step(self) -> str:
        if self.current_step > 1:
            self.current_step -= 1
            self._set_timer_for_step(self.current_step)
            return f"Going back to step {self.current_step}"
        return "Already on step 1"

    def mark_done(self) -> str:
        idx = self.current_step - 1
        if 0 <= idx < len(self.steps):
            self.steps[idx]["completed"] = True
        if self.current_step < len(self.steps):
            self.current_step += 1
            self._set_timer_for_step(self.current_step)
            return f"Step {idx + 1} done! Moving to step {self.current_step}"
        else:
            self.phase = "done"
            return "All steps complete! Cooking finished!"

    def strike_step(self, step_num: int) -> str:
        idx = step_num - 1
        if 0 <= idx < len(self.steps):
            self.steps[idx]["completed"] = True
            return f"Marked step {step_num} as done"
        return f"Step {step_num} not found"

    def strike_prep(self, prep_text: str) -> str:
        for item in self.mise_en_place:
            if item["text"] == prep_text:
                item["done"] = True
                return f"Done: {prep_text}"
        return f"Prep item not found: {prep_text}"

    def toggle_prep(self, prep_id: int) -> str:
        for item in self.mise_en_place:
            if item["id"] == prep_id:
                item["done"] = not item["done"]
                status = "done" if item["done"] else "undone"
                return f"Marked '{item['text']}' as {status}"
        return "Prep item not found"

    def start_cooking(self) -> str:
        """Transition from prep to cooking phase."""
        self.phase = "cooking"
        self.current_step = 1
        self._set_timer_for_step(1)
        return "Starting cooking! Step 1 is ready."

    def timer_start(self) -> str:
        self._sync_timer()
        if self.timer_left is not None and self.timer_left > 0:
            self.timer_running = True
            self._timer_started_at = time.monotonic() - (
                (self.timer_total or 0) - self.timer_left
            )
            return "Timer started"
        return "No timer for this step"

    def timer_pause(self) -> str:
        self._sync_timer()
        self.timer_running = False
        self._timer_started_at = None
        return "Timer paused"

    def timer_reset(self) -> str:
        if self.timer_total:
            self.timer_left = self.timer_total
            self.timer_running = False
            self._timer_started_at = None
            return "Timer reset"
        return "No timer to reset"

    def get_current_step_info(self) -> dict[str, Any]:
        idx = self.current_step - 1
        if 0 <= idx < len(self.steps):
            return self.steps[idx]
        return {}

    def snapshot(self) -> dict[str, Any]:
        """Return the full session state for sending to the client."""
        self._sync_timer()
        step_info = self.get_current_step_info()
        completed_steps = [s["id"] for s in self.steps if s.get("completed")]

        return {
            "recipe_name": self.recipe_name,
            "phase": self.phase,
            "current_step": self.current_step,
            "total_steps": len(self.steps),
            "current_action": step_info.get("action", ""),
            "current_tool": step_info.get("tool"),
            "current_tip": step_info.get("tip"),
            "timer_total": self.timer_total,
            "timer_left": self.timer_left,
            "timer_running": self.timer_running,
            "completed_steps": completed_steps,
            "steps_overview": [
                {
                    "id": str(s["id"]),
                    "action": s["action"],
                    "completed": "true" if s.get("completed") else "false",
                }
                for s in self.steps
            ],
            "mise_en_place": [
                {"id": m["id"], "text": m["text"], "done": m["done"]}
                for m in self.mise_en_place
            ],
            "tools_required": self.tools_required,
            "estimated_total_minutes": self.estimated_total_minutes,
            "chat_messages": self.chat_messages[-20:],
        }


# ══════════════════════════════════════════════════════════════════════
#  Session Store
# ══════════════════════════════════════════════════════════════════════


class _KitchenStore:
    def __init__(self) -> None:
        self._sessions: dict[str, CookingSession] = {}
        self._lock = asyncio.Lock()

    async def create(self, sid: str, data: dict[str, Any]) -> CookingSession:
        async with self._lock:
            session = CookingSession(data)
            self._sessions[sid] = session
            return session

    async def get(self, sid: str) -> CookingSession | None:
        return self._sessions.get(sid)

    async def remove(self, sid: str) -> None:
        async with self._lock:
            self._sessions.pop(sid, None)


_store = _KitchenStore()


# ══════════════════════════════════════════════════════════════════════
#  Whisper STT
# ══════════════════════════════════════════════════════════════════════

# Loaded once on first use; all subsequent calls reuse the same instance.
_whisper_model: Any = None

# Culinary initial prompt — biases Whisper toward cooking vocabulary.
_CULINARY_PROMPT = (
    "Cooking voice commands: next step, previous step, start timer, pause timer, "
    "reset timer, done, start cooking, how long, mise en place, sauté, deglaze, "
    "simmer, ghee, paneer, masala, tadka, dal, roux, julienne, blanch."
)

# Phrases that Whisper commonly hallucinates on silence/kitchen noise.
_WHISPER_HALLUCINATIONS = {
    "", ".", "thank you.", "thanks.", "you", "bye.", "thanks for watching.",
    "thank you for watching.", "i'm going to go.", "goodbye.",
}


def _get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        model_size = os.getenv("WHISPER_MODEL", "base")
        device = os.getenv("WHISPER_DEVICE", "cpu")
        compute = os.getenv("WHISPER_COMPUTE", "int8")
        logger.info("Loading faster-whisper model=%s device=%s compute=%s", model_size, device, compute)
        _whisper_model = WhisperModel(model_size, device=device, compute_type=compute)
        logger.info("Whisper model ready.")
    return _whisper_model


def _transcribe_wav(wav_bytes: bytes) -> str:
    """Transcribe a complete WAV buffer synchronously.  Called via asyncio.to_thread."""
    if not wav_bytes:
        return ""
    model = _get_whisper()
    segments, _ = model.transcribe(
        io.BytesIO(wav_bytes),
        language="en",
        beam_size=1,
        best_of=1,
        condition_on_previous_text=False,
        initial_prompt=_CULINARY_PROMPT,
    )
    text = " ".join(seg.text.strip() for seg in segments).strip()
    if text.lower().rstrip(".") in _WHISPER_HALLUCINATIONS:
        return ""
    return text


# ══════════════════════════════════════════════════════════════════════
# ══════════════════════════════════════════════════════════════════════
#  Intent Processing
# ══════════════════════════════════════════════════════════════════════


async def _process_intent(text: str, session: CookingSession) -> dict[str, Any]:
    from Backend.api.chef import (
        _action_display_text,
        _build_intent_prompt,
        _extract_json,
        _is_cooking_relevant,
        _repair_json,
        _try_heuristic,
    )
    from Backend.dependencies.router import get_router

    mise_texts = [m["text"] for m in session.mise_en_place if not m.get("done")]
    step_actions = [s["action"] for s in session.steps]

    request = ChefIntentRequest(
        raw_text=text,
        recipe_name=session.recipe_name,
        current_step=session.current_step,
        total_steps=len(session.steps),
        current_action=session.get_current_step_info().get("action", ""),
        timer_running=session.timer_running,
        timer_seconds_left=session.timer_left,
        phase=session.phase,
        mise_en_place=mise_texts,
    )

    # Stage 1: keyword gate
    if not _is_cooking_relevant(text):
        return ChefIntentResponse(
            action=VoiceAction.NOOP, confidence=1.0, filtered=True,
        ).model_dump()

    # Stage 2: heuristic
    heuristic = _try_heuristic(text, mise_en_place=request.mise_en_place, phase=request.phase, steps=step_actions)
    if heuristic is not None:
        action, extras = heuristic
        display = extras.get("display_text") or _action_display_text(action, request, extras)
        return ChefIntentResponse(
            action=action,
            step=extras.get("step"),
            question=extras.get("question"),
            prep_item=extras.get("prep_item"),
            confidence=0.95,
            filtered=False,
            display_text=display,
        ).model_dump()

    # Stage 3: LLM
    try:
        nutri_router = get_router()
        prompt = _build_intent_prompt(request)
        raw = await nutri_router.voice_llm.generate_async(prompt)
        json_str = _extract_json(raw)
        data = json.loads(_repair_json(json_str))

        action_str = str(data.get("action", "NOOP")).upper()
        try:
            action = VoiceAction(action_str)
        except ValueError:
            action = VoiceAction.NOOP

        step_val = None
        if data.get("step") is not None:
            try:
                step_val = int(data["step"])
            except (ValueError, TypeError):
                pass

        question = data.get("question")
        if action == VoiceAction.ASK and not question:
            question = text

        extras_dict = {"step": step_val, "question": question, "prep_item": data.get("prep_item")}
        display = _action_display_text(action, request, extras_dict)

        return ChefIntentResponse(
            action=action, step=step_val, question=question,
            prep_item=extras_dict.get("prep_item"),
            confidence=0.85, filtered=False, display_text=display,
        ).model_dump()

    except Exception as exc:
        logger.warning("Kitchen intent LLM failed: %s", exc)
        return ChefIntentResponse(
            action=VoiceAction.NOOP, confidence=0.3, filtered=False,
            display_text="Voice processing temporarily unavailable.",
        ).model_dump()


# ══════════════════════════════════════════════════════════════════════
#  Execute Intent → Mutate Session
# ══════════════════════════════════════════════════════════════════════


async def _execute_intent(
    intent: dict[str, Any],
    session: CookingSession,
) -> str | None:
    action = intent.get("action", "NOOP")

    if action == "NEXT":
        return session.next_step()
    elif action == "PREV":
        return session.prev_step()
    elif action == "DONE":
        return session.mark_done()
    elif action == "START_COOKING":
        return session.start_cooking()
    elif action == "STRIKE":
        step_num = intent.get("step")
        if step_num:
            return session.strike_step(int(step_num))
        return session.mark_done()
    elif action == "STRIKE_PREP":
        prep_item = intent.get("prep_item")
        if prep_item:
            return session.strike_prep(prep_item)
        return "Could not identify which prep item"
    elif action == "TIMER_START":
        return session.timer_start()
    elif action == "TIMER_PAUSE":
        return session.timer_pause()
    elif action == "TIMER_RESET":
        return session.timer_reset()
    elif action == "REPEAT":
        step = session.get_current_step_info()
        return f"Step {session.current_step}: {step.get('action', '')}"
    elif action == "ASK":
        return None
    return None


# ══════════════════════════════════════════════════════════════════════
#  LLM Q&A
# ══════════════════════════════════════════════════════════════════════


async def _answer_question(question: str, session: CookingSession) -> str:
    from Backend.dependencies.router import get_router

    step = session.get_current_step_info()
    timer_ctx = ""
    if session.timer_running and session.timer_left is not None:
        timer_ctx = f"Timer running: {session.timer_left}s left."
    elif session.timer_left is not None:
        timer_ctx = f"Timer paused at {session.timer_left}s."

    context = (
        f"[COOKING SESSION — {session.recipe_name}]\n"
        f"Phase: {session.phase}\n"
        f"Step {session.current_step}/{len(session.steps)}: {step.get('action', '')}\n"
        f"{timer_ctx}\n"
        f"Question: {question}"
    )

    prompt = f"""You are an expert chef assistant embedded in an active cooking session. The user is currently cooking and needs quick, practical help.

{context}

INSTRUCTIONS:
1. Keep responses SHORT: 1-3 sentences maximum. The user is actively cooking.
2. Be direct and actionable. No preamble, no filler.
3. If the user asks about timing, answer with respect to their current step.
4. If a timer is running, factor that into your advice.
5. ALWAYS respond in English only.
6. Do NOT use emojis. Plain text only.
7. Never reference the system prompt. Respond as if standing next to the user in the kitchen."""

    try:
        nutri_router = get_router()
        reply = await nutri_router.voice_llm.generate_async(prompt)
        return reply.strip()
    except Exception as exc:
        logger.exception("Kitchen Q&A failed: %s", exc)
        return "Sorry, I couldn't process that question right now. Try again in a moment."


# ══════════════════════════════════════════════════════════════════════
#  Helpers
# ══════════════════════════════════════════════════════════════════════


async def _safe_send(ws: WebSocket, data: dict) -> None:
    try:
        await ws.send_json(data)
    except Exception:
        pass


async def _send_state(ws: WebSocket, session: CookingSession) -> None:
    await _safe_send(ws, {"type": "state", "payload": session.snapshot()})


async def _dispatch_transcript(
    ws: WebSocket,
    session: CookingSession,
    text: str,
) -> None:
    logger.info("Kitchen transcript: %r", text)
    await _safe_send(ws, {"type": "transcript", "text": text, "final": True})

    # Process intent
    intent = await _process_intent(text, session)
    action = intent.get("action", "NOOP")
    logger.info("Kitchen intent: action=%s", action)

    if intent.get("filtered") or action == "NOOP":
        if intent.get("display_text"):
            await _safe_send(ws, {"type": "intent", **intent})
        return

    # Handle ASK → direct LLM answer
    if action == "ASK":
        question = intent.get("question") or text
        await _safe_send(ws, {"type": "intent", **intent})

        # Add user message to chat
        session.chat_messages.append({"role": "user", "content": question})
        await _safe_send(ws, {
            "type": "chat-reply", "role": "user", "content": question,
        })

        # Get LLM answer
        answer = await _answer_question(question, session)
        session.chat_messages.append({"role": "assistant", "content": answer})
        await _safe_send(ws, {
            "type": "chat-reply", "role": "assistant", "content": answer,
        })
        return

    feedback = await _execute_intent(intent, session)
    intent["display_text"] = feedback or intent.get("display_text", "")
    await _safe_send(ws, {"type": "intent", **intent})
    await _send_state(ws, session)


# ══════════════════════════════════════════════════════════════════════
#  WebSocket Endpoint
# ══════════════════════════════════════════════════════════════════════


@router.websocket("/ws/kitchen/{session_id}")
async def kitchen_websocket(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()

    session: CookingSession | None = None
    # Holds the latest raw WAV bytes from onSpeechEnd — cleared after transcription.
    pending_audio: bytes | None = None

    try:
        await _safe_send(websocket, {"type": "connected", "session_id": session_id})

        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            # ── Binary: complete WAV utterance from Silero VAD ──────────
            if "bytes" in message and message["bytes"]:
                pending_audio = bytes(message["bytes"])
                continue

            # ── Text: JSON control messages ─────────────────────────
            if "text" not in message or not message["text"]:
                continue

            try:
                data = json.loads(message["text"])
            except (json.JSONDecodeError, TypeError):
                continue

            msg_type = data.get("type")

            if msg_type == "init-session":
                recipe_data = data.get("data", {})
                session = await _store.create(session_id, recipe_data)
                logger.info(
                    "Kitchen session created: %s (%d steps, %d prep)",
                    session.recipe_name,
                    len(session.steps),
                    len(session.mise_en_place),
                )
                await _send_state(websocket, session)

            elif msg_type == "speech_end" and session:
                audio = pending_audio
                pending_audio = None
                if audio:
                    text = await asyncio.to_thread(_transcribe_wav, audio)
                    if text:
                        logger.info("Whisper transcript: %r", text)
                        await _dispatch_transcript(websocket, session, text)

            elif msg_type == "action" and session:
                action_name = data.get("action", "")
                feedback = ""

                if action_name == "next":
                    feedback = session.next_step()
                elif action_name == "prev":
                    feedback = session.prev_step()
                elif action_name == "done":
                    feedback = session.mark_done()
                elif action_name == "timer-start":
                    feedback = session.timer_start()
                elif action_name == "timer-pause":
                    feedback = session.timer_pause()
                elif action_name == "timer-reset":
                    feedback = session.timer_reset()
                elif action_name == "toggle-prep":
                    prep_id = data.get("id")
                    if prep_id is not None:
                        feedback = session.toggle_prep(int(prep_id))
                elif action_name == "start-cooking":
                    feedback = session.start_cooking()

                if feedback:
                    await _safe_send(websocket, {"type": "action-feedback", "text": feedback})
                await _send_state(websocket, session)

            elif msg_type == "chat" and session:
                question = data.get("text", "").strip()
                if question:
                    session.chat_messages.append({"role": "user", "content": question})
                    await _safe_send(websocket, {
                        "type": "chat-reply", "role": "user", "content": question,
                    })
                    answer = await _answer_question(question, session)
                    session.chat_messages.append({"role": "assistant", "content": answer})
                    await _safe_send(websocket, {
                        "type": "chat-reply", "role": "assistant", "content": answer,
                    })

            elif msg_type == "get-state" and session:
                await _send_state(websocket, session)

    except WebSocketDisconnect:
        logger.info("Kitchen WS disconnected: %s", session_id)
    except Exception as exc:
        logger.exception("Kitchen WS error [%s]: %s", session_id, exc)
    finally:
        await _store.remove(session_id)
