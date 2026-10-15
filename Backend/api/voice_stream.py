"""
WebSocket voice-streaming endpoint for the AI Chef Kitchen Remote.

Replaces the legacy PeerJS WebRTC + client-side Web Speech API architecture
with a direct WebSocket audio pipeline:

    Phone (MediaRecorder) ──WebM/Opus chunks──► FastAPI WebSocket
        ──► Audio Buffer ──► Silence Detection ──► STT Engine
        ──► Chef Intent Pipeline ──► JSON Response ──► Phone UI

Architecture:
    1. Client captures audio via ``MediaRecorder`` (WebM/Opus, 250ms chunks).
    2. Binary chunks stream to this WebSocket endpoint.
    3. An energy-based Voice Activity Detector (VAD) segments the continuous
       stream into discrete utterances using Opus VBR chunk-size heuristics.
    4. Complete utterances are passed to the modular STT engine (default:
       faster-whisper local model; swappable for Deepgram/Google/Azure).
    5. Transcribed text runs through the existing 3-stage chef intent pipeline
       (keyword gate → heuristic patterns → LLM fallback).
    6. Results stream back to the client as typed JSON messages.

Session Registry:
    Maps ``session_id`` to paired WebSocket connections (phone + host PC).
    The PC pushes ``CookingSessionState`` updates, which the backend relays
    to the phone in real-time — replacing the removed PeerJS data channel.

Microsoft Store Compliance:
    This endpoint uses standard WebSockets (no WebRTC, no third-party broker),
    making it fully compatible with the Windows App Container sandbox.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import time
from typing import Any, Optional

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from Backend.schemas.chef import (
    ChefIntentRequest,
    ChefIntentResponse,
    VoiceAction,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Voice Stream"])


# ══════════════════════════════════════════════════════════════════════
#  Session Registry
# ══════════════════════════════════════════════════════════════════════


class _SessionRegistry:
    """In-memory registry mapping session IDs to paired WebSocket connections.

    Thread-safe via ``asyncio.Lock``.  Each session can have at most one
    *phone* (the kitchen remote) and one *host* (the PC running chef.tsx).
    State snapshots are cached so the phone receives the latest cooking
    state immediately on (re-)connect.
    """

    def __init__(self) -> None:
        self._phones: dict[str, WebSocket] = {}
        self._hosts: dict[str, WebSocket] = {}
        self._states: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    # ── Registration ────────────────────────────────────────────────

    async def register_phone(self, sid: str, ws: WebSocket) -> None:
        async with self._lock:
            self._phones[sid] = ws

    async def register_host(self, sid: str, ws: WebSocket) -> None:
        async with self._lock:
            self._hosts[sid] = ws

    async def unregister(self, sid: str, role: str) -> None:
        async with self._lock:
            if role == "phone":
                self._phones.pop(sid, None)
            else:
                self._hosts.pop(sid, None)
            # Clean up state when both sides disconnect
            if sid not in self._phones and sid not in self._hosts:
                self._states.pop(sid, None)

    # ── Lookups ─────────────────────────────────────────────────────

    def get_phone(self, sid: str) -> Optional[WebSocket]:
        return self._phones.get(sid)

    def get_host(self, sid: str) -> Optional[WebSocket]:
        return self._hosts.get(sid)

    def set_state(self, sid: str, state: dict[str, Any]) -> None:
        self._states[sid] = state

    def get_state(self, sid: str) -> Optional[dict[str, Any]]:
        return self._states.get(sid)


_registry = _SessionRegistry()


# ══════════════════════════════════════════════════════════════════════
#  Modular Speech-to-Text Engine
# ══════════════════════════════════════════════════════════════════════
#
#  The STT interface is a single async function:
#      transcribe_audio(audio_bytes, format) -> str
#
#  Swap the implementation by changing _ACTIVE_STT_BACKEND below.
#  Supported backends:
#      "faster-whisper"  – Local model, zero API cost, ~4× realtime on CPU.
#      "deepgram"        – Cloud API, sub-200ms latency, requires API key.
#
#  Both are wrapped behind the same interface so the voice pipeline is
#  completely agnostic to the provider.
# ══════════════════════════════════════════════════════════════════════

_ACTIVE_STT_BACKEND: str = os.getenv("STT_BACKEND", "faster-whisper")

# ── Faster-Whisper (local) ──────────────────────────────────────────

_whisper_model: Any = None
_whisper_lock = asyncio.Lock()


async def _get_whisper_model() -> Any:
    """Lazy-load the faster-whisper model as a singleton.

    Uses ``base.en`` by default (good speed/accuracy trade-off for English
    cooking commands).  Override with ``STT_MODEL_SIZE`` env var.
    """
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model

    async with _whisper_lock:
        if _whisper_model is not None:
            return _whisper_model

        from faster_whisper import WhisperModel  # type: ignore[import-untyped]

        model_size = os.getenv("STT_MODEL_SIZE", "small.en")
        device = os.getenv("STT_DEVICE", "cpu")
        compute = os.getenv("STT_COMPUTE_TYPE", "int8")

        _whisper_model = await asyncio.to_thread(
            WhisperModel, model_size, device=device, compute_type=compute
        )
        logger.info(
            "faster-whisper model loaded: size=%s device=%s compute=%s",
            model_size,
            device,
            compute,
        )
        return _whisper_model


def _decode_audio_to_float32(audio_bytes: bytes) -> np.ndarray:
    """Decode audio bytes (WebM/Opus, WAV, etc.) to float32 mono 16 kHz ndarray.

    Uses PyAV (bundled with faster-whisper) so no system ffmpeg is needed.
    """
    import av  # shipped with faster-whisper; bundles its own ffmpeg libs

    container = av.open(io.BytesIO(audio_bytes), format=None)
    resampler = av.AudioResampler(
        format="s16",
        layout="mono",
        rate=16000,
    )

    raw_frames: list[bytes] = []
    for frame in container.decode(audio=0):
        for resampled in resampler.resample(frame):
            raw_frames.append(bytes(resampled.planes[0]))
    container.close()

    if not raw_frames:
        return np.array([], dtype=np.float32)

    pcm = b"".join(raw_frames)
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    return samples


async def _transcribe_whisper(audio_bytes: bytes, fmt: str) -> str:
    """Transcribe using local faster-whisper model.

    Decodes audio via PyAV (no system ffmpeg needed) and feeds a float32
    ndarray directly to faster-whisper, bypassing pydub entirely.
    """
    model = await _get_whisper_model()
    loop = asyncio.get_running_loop()

    # Cooking vocabulary prompt — primes Whisper's decoder to expect
    # kitchen-related words, dramatically improving accuracy for short commands.
    _COOKING_PROMPT = (
        "done, next step, previous, start timer, pause timer, reset timer, "
        "repeat, finished, chopping, washing, grinding, carrot, onion, "
        "garlic, ginger, masala, dal, rice, idli, dosa, roti, paneer, "
        "chop, slice, dice, peel, soak, grate, boil, fry, cook, steam, "
        "blend, mix, knead, marinate, batter, spices, oil, water, salt, "
        "how long, why, what, temperature, ready, done with"
    )

    def _run() -> str:
        audio_array = _decode_audio_to_float32(audio_bytes)
        if audio_array.size == 0:
            return ""
        segments, info = model.transcribe(
            audio_array,
            language="en",
            beam_size=3,
            vad_filter=True,
            condition_on_previous_text=False,
            no_speech_threshold=0.5,
            initial_prompt=_COOKING_PROMPT,
        )
        text = " ".join(seg.text.strip() for seg in segments)
        if text:
            logger.debug("Whisper transcribed (%.1fs audio): %r", info.duration, text)
        return text

    return (await loop.run_in_executor(None, _run)).strip()


# ── Deepgram (cloud) ───────────────────────────────────────────────

async def _transcribe_deepgram(audio_bytes: bytes, fmt: str) -> str:
    """Transcribe using Deepgram's Nova-2 streaming API.

    Requires ``DEEPGRAM_API_KEY`` environment variable.
    """
    import httpx  # already a project dependency

    api_key = os.getenv("DEEPGRAM_API_KEY", "")
    if not api_key:
        logger.error("DEEPGRAM_API_KEY not set — falling back to empty transcript")
        return ""

    mime = "audio/webm" if fmt == "webm" else f"audio/{fmt}"
    url = "https://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true"

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            url,
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": mime,
            },
            content=audio_bytes,
        )
        resp.raise_for_status()
        data = resp.json()

    alternatives = (
        data.get("results", {})
        .get("channels", [{}])[0]
        .get("alternatives", [{}])
    )
    return alternatives[0].get("transcript", "").strip() if alternatives else ""


# ── Public interface ────────────────────────────────────────────────

async def transcribe_audio(audio_bytes: bytes, fmt: str = "webm") -> str:
    """Transcribe audio bytes to text.

    Delegates to the active STT backend configured via ``STT_BACKEND`` env
    var.  Returns an empty string on failure — never raises.

    Args:
        audio_bytes: Raw audio file bytes (WebM/Opus, WAV, etc.).
        fmt: Container format hint (``"webm"``, ``"wav"``, ``"mp3"``).

    Returns:
        Transcribed text, or ``""`` on failure.
    """
    if not audio_bytes or len(audio_bytes) < 100:
        logger.debug("Skipping transcription: audio too small (%d bytes)", len(audio_bytes))
        return ""

    try:
        if _ACTIVE_STT_BACKEND == "deepgram":
            return await _transcribe_deepgram(audio_bytes, fmt)
        else:
            return await _transcribe_whisper(audio_bytes, fmt)
    except Exception as exc:
        logger.exception("Transcription failed (%s): %s", _ACTIVE_STT_BACKEND, exc)
        return ""


# ══════════════════════════════════════════════════════════════════════
#  Voice Activity Detection (VAD)
# ══════════════════════════════════════════════════════════════════════


class WebmAccumulator:
    """Accumulates WebM/Opus chunks and ensures each utterance has a valid header.

    WebM (Matroska) streams from MediaRecorder start with an EBML header +
    Segment + Tracks, followed by Cluster elements with actual audio data.
    When the continuous stream is split into utterances by VAD, only the first
    flush contains the header — subsequent flushes are raw Cluster data that
    ``av.open()`` cannot decode.

    This class extracts the WebM initialization segment from the first chunks
    and prepends it to every utterance so each can be decoded independently.
    """

    _EBML_MAGIC = b'\x1a\x45\xdf\xa3'
    _CLUSTER_ID = b'\x1f\x43\xb6\x75'

    def __init__(self) -> None:
        self._header: bytes | None = None
        self._buffer = bytearray()

    def extend(self, chunk: bytes) -> None:
        self._buffer.extend(chunk)
        if self._header is None:
            self._try_extract_header()

    def _try_extract_header(self) -> None:
        buf = bytes(self._buffer)
        if not buf.startswith(self._EBML_MAGIC):
            return
        pos = buf.find(self._CLUSTER_ID)
        if pos > 0:
            self._header = buf[:pos]
            logger.debug("WebM header extracted: %d bytes", len(self._header))

    def flush(self) -> bytes:
        """Return buffer contents as a decodable WebM byte string, then clear."""
        data = bytes(self._buffer)
        self._buffer.clear()
        if not data:
            return data
        if data.startswith(self._EBML_MAGIC):
            return data
        if self._header:
            return self._header + data
        return data

    def clear(self) -> None:
        """Clear audio data but preserve the header."""
        self._buffer.clear()

    def reset(self) -> None:
        """Full reset including header (e.g. when MediaRecorder restarts)."""
        self._header = None
        self._buffer.clear()

    def __bool__(self) -> bool:
        return len(self._buffer) > 0


class VoiceActivityDetector:
    """Energy-based VAD for streaming WebM/Opus audio.

    **Why chunk-size heuristics instead of raw PCM energy?**

    WebRTC-VAD (``webrtcvad``) requires decoded PCM at specific sample rates,
    meaning every 250ms chunk would need a full WebM→PCM decode — expensive
    for real-time streaming.  Opus uses Variable Bit Rate (VBR) encoding,
    which means silence frames are dramatically smaller than speech frames:

        - Speech chunk (250ms Opus): ~400–3 000 bytes
        - Silence chunk (250ms Opus): ~30–150 bytes

    Thresholding on compressed chunk size is a fast, FFmpeg-free pre-filter
    that correctly identifies >95 % of speech boundaries without touching the
    audio decoder.  The actual transcription (``transcribe_audio``) applies
    faster-whisper's built-in VAD filter for a second-pass cleanup.

    **State machine:**

    ::

        IDLE ──(speech chunk)──► SPEAKING
        SPEAKING ──(silence chunk)──► TRAILING_SILENCE
        TRAILING_SILENCE ──(speech chunk)──► SPEAKING
        TRAILING_SILENCE ──(gap elapsed)──► IDLE  [utterance flushed]

    Attributes:
        silence_threshold_bytes: Chunk size at or below which we assume silence.
        silence_gap_s: Seconds of consecutive silence before flushing.
        min_speech_s: Minimum speech duration to avoid transcribing noise pops.
    """

    def __init__(
        self,
        silence_threshold_bytes: int = 200,
        silence_gap_s: float = 0.75,
        min_speech_s: float = 0.3,
    ) -> None:
        self.silence_threshold_bytes = silence_threshold_bytes
        self.silence_gap_s = silence_gap_s
        self.min_speech_s = min_speech_s

        self._speaking = False
        self._silence_start: Optional[float] = None
        self._speech_start: Optional[float] = None
        self._chunk_count = 0

    def feed_chunk(self, chunk: bytes) -> bool:
        """Ingest a new audio chunk and return whether an utterance just ended.

        Call this for every binary frame received from the client.  When this
        returns ``True``, the caller should extract the accumulated audio
        buffer and pass it to ``transcribe_audio()``.

        Returns:
            ``True`` if a complete utterance boundary was detected.
        """
        self._chunk_count += 1
        now = time.monotonic()
        is_speech = len(chunk) > self.silence_threshold_bytes

        if is_speech:
            if not self._speaking:
                # IDLE → SPEAKING
                self._speaking = True
                self._speech_start = now
                logger.debug(
                    "VAD: speech start (chunk #%d, %d bytes)",
                    self._chunk_count,
                    len(chunk),
                )
            # Reset trailing-silence counter whenever a speech chunk arrives
            self._silence_start = None

        elif self._speaking:
            # SPEAKING or TRAILING_SILENCE with a silent chunk
            if self._silence_start is None:
                # SPEAKING → TRAILING_SILENCE
                self._silence_start = now
            else:
                gap = now - self._silence_start
                if gap >= self.silence_gap_s:
                    # Gap exceeded — utterance complete
                    speech_dur = (
                        (self._silence_start - self._speech_start)
                        if self._speech_start
                        else 0.0
                    )
                    self._reset_state()

                    if speech_dur >= self.min_speech_s:
                        logger.debug(
                            "VAD: utterance complete (%.1fs speech, %.1fs gap)",
                            speech_dur,
                            gap,
                        )
                        return True
                    else:
                        logger.debug(
                            "VAD: speech too short (%.2fs), discarded",
                            speech_dur,
                        )

        return False

    def force_flush(self) -> bool:
        """Force-flush any pending speech (e.g. when recording stops).

        Returns ``True`` if there was accumulated speech worth transcribing.
        """
        if self._speaking and self._speech_start is not None:
            dur = time.monotonic() - self._speech_start
            self._reset_state()
            return dur >= self.min_speech_s
        return False

    def reset(self) -> None:
        """Fully reset the state machine."""
        self._reset_state()
        self._chunk_count = 0

    def _reset_state(self) -> None:
        self._speaking = False
        self._silence_start = None
        self._speech_start = None


# ══════════════════════════════════════════════════════════════════════
#  Intent Processing (reuses Backend/api/chef.py logic inline)
# ══════════════════════════════════════════════════════════════════════


async def _process_voice_intent(
    text: str,
    session_state: dict[str, Any],
) -> dict[str, Any]:
    """Run transcribed text through the 3-stage chef intent pipeline.

    Imports the filtering and heuristic functions from ``Backend.api.chef``
    so the voice-streaming path uses *exactly* the same logic as the REST
    ``POST /chef/intent`` endpoint — no duplication.

    Args:
        text: Transcribed utterance text.
        session_state: Current ``CookingSessionState`` as a plain dict.

    Returns:
        ``ChefIntentResponse`` serialised as a dict.
    """
    # Late import to avoid circular dependency at module load time
    from Backend.api.chef import (
        _action_display_text,
        _build_intent_prompt,
        _extract_json,
        _is_cooking_relevant,
        _repair_json,
        _try_heuristic,
    )
    from Backend.dependencies.router import get_router

    # Build request from session state
    mise_texts: list[str] = []
    for item in session_state.get("mise_en_place", []):
        if isinstance(item, dict) and "text" in item:
            mise_texts.append(item["text"])

    step_actions: list[str] = []
    for s in session_state.get("steps_overview", []):
        if isinstance(s, dict) and "action" in s:
            step_actions.append(s["action"])

    request = ChefIntentRequest(
        raw_text=text,
        recipe_name=session_state.get("recipe_name", "Unknown"),
        current_step=session_state.get("current_step", 1),
        total_steps=session_state.get("total_steps", 1),
        current_action=session_state.get("current_action", ""),
        timer_running=session_state.get("timer_running", False),
        timer_seconds_left=session_state.get("timer_left"),
        phase=session_state.get("phase", "cooking"),
        mise_en_place=mise_texts,
    )

    # ── Stage 1: keyword gate ──────────────────────────────────────
    if not _is_cooking_relevant(text):
        return ChefIntentResponse(
            action=VoiceAction.NOOP,
            confidence=1.0,
            filtered=True,
        ).model_dump()

    # ── Stage 2: heuristic shortcuts ───────────────────────────────
    heuristic = _try_heuristic(
        text,
        mise_en_place=request.mise_en_place,
        phase=request.phase,
        steps=step_actions,
    )
    if heuristic is not None:
        action, extras = heuristic
        display = extras.get("display_text") or _action_display_text(
            action, request, extras
        )
        return ChefIntentResponse(
            action=action,
            step=extras.get("step"),
            question=extras.get("question"),
            prep_item=extras.get("prep_item"),
            confidence=0.95,
            filtered=False,
            display_text=display,
        ).model_dump()

    # ── Stage 3: LLM fallback ─────────────────────────────────────
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

        step_val: int | None = None
        if data.get("step") is not None:
            try:
                step_val = int(data["step"])
            except (ValueError, TypeError):
                pass

        question = data.get("question")
        if action == VoiceAction.ASK and not question:
            question = text

        extras_dict: dict[str, Any] = {
            "step": step_val,
            "question": question,
            "prep_item": data.get("prep_item"),
        }
        display = _action_display_text(action, request, extras_dict)

        return ChefIntentResponse(
            action=action,
            step=step_val,
            question=question,
            prep_item=extras_dict.get("prep_item"),
            confidence=0.85,
            filtered=False,
            display_text=display,
        ).model_dump()

    except Exception as exc:
        logger.warning("Voice intent LLM failed: %s", exc)
        return ChefIntentResponse(
            action=VoiceAction.NOOP,
            confidence=0.3,
            filtered=False,
            display_text="Voice processing temporarily unavailable.",
        ).model_dump()


# ══════════════════════════════════════════════════════════════════════
#  REST endpoint: PC pushes session state
# ══════════════════════════════════════════════════════════════════════


@router.post("/api/chef-session/{session_id}/state")
async def push_session_state(session_id: str, payload: dict[str, Any]) -> dict:
    """Accept a CookingSessionState push from the PC host.

    Stores the state in the session registry and relays it to any
    connected phone WebSocket in real-time.  Called by ``chef.tsx``
    whenever the session state changes (step navigation, timer tick, etc.).
    """
    _registry.set_state(session_id, payload)

    phone_ws = _registry.get_phone(session_id)
    if phone_ws is not None:
        try:
            await phone_ws.send_json({"type": "state", "payload": payload})
        except Exception:
            pass

    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════
#  WebSocket Endpoint
# ══════════════════════════════════════════════════════════════════════


async def _safe_send_json(ws: WebSocket, data: dict) -> None:
    """Send JSON to a WebSocket, swallowing errors from closed connections."""
    try:
        await ws.send_json(data)
    except Exception:
        pass


async def _handle_utterance(
    ws: WebSocket,
    session_id: str,
    audio_data: bytes,
) -> None:
    """Transcribe an utterance, run intent parsing, and send results.

    This is the core pipeline invoked when the VAD detects a complete
    utterance boundary:

    1. ``transcribe_audio()`` — STT (local or cloud).
    2. ``_process_voice_intent()`` — 3-stage intent pipeline.
    3. Send ``transcript`` + ``intent`` JSON messages to the phone.
    4. Relay the intent to the host PC so it can update session state.
    """
    # ── Step 1: Transcribe ──────────────────────────────────────────
    logger.info("Processing utterance [%s]: %d bytes", session_id, len(audio_data))
    
    # Auto-detect format from magic bytes
    fmt = "wav" if audio_data.startswith(b"RIFF") else "webm"
    text = await transcribe_audio(audio_data, fmt=fmt)
    
    if not text:
        logger.debug("Empty transcript for [%s] — skipping intent", session_id)
        return

    logger.info("Transcribed [%s]: %r", session_id, text)

    # ── Step 2: Send final transcript for live display ──────────────
    await _safe_send_json(ws, {"type": "transcript", "text": text, "final": True})

    # Also relay transcript to host PC for the live voice indicator
    host_ws = _registry.get_host(session_id)
    if host_ws is not None:
        await _safe_send_json(host_ws, {"type": "transcript", "text": text, "final": True})

    # ── Step 3: Process through chef intent pipeline ────────────────
    session_state = _registry.get_state(session_id) or {}
    intent = await _process_voice_intent(text, session_state)
    logger.info("Intent [%s]: action=%s filtered=%s", session_id, intent.get("action"), intent.get("filtered"))

    # ── Step 4: Send intent to phone ────────────────────────────────
    await _safe_send_json(ws, {"type": "intent", **intent})

    # ── Step 5: Relay intent to host PC for state management ────────
    # Include raw_text so the host knows what the user said
    host_ws = _registry.get_host(session_id)
    if host_ws is not None:
        await _safe_send_json(host_ws, {"type": "voice-intent", "raw_text": text, **intent})


@router.websocket("/ws/chef-voice/{session_id}")
async def chef_voice_websocket(websocket: WebSocket, session_id: str) -> None:
    """Persistent WebSocket for voice-streamed cooking assistance.

    Supports two roles:

    - **phone** (default): The kitchen remote.  Sends binary audio chunks
      and receives transcripts, intents, and session state updates.
    - **host**: The PC running ``chef.tsx``.  Pushes session state updates
      and receives voice intents + phone actions to process.

    Protocol
    --------
    **Client → Server:**

    ==================  ========  ==========================================
    Frame type          Format    Description
    ==================  ========  ==========================================
    Binary              bytes     Raw WebM/Opus audio chunk (250 ms)
    ``init``            JSON      ``{"type":"init","role":"phone"|"host",
                                  "state":{...}}``
    ``action``          JSON      Manual button tap:
                                  ``{"type":"action","action":"next",...}``
    ``chat``            JSON      Chat question:
                                  ``{"type":"chat","text":"How long?"}``
    ``state``           JSON      State push (host):
                                  ``{"type":"state","payload":{...}}``
    ``chat-reply``      JSON      Chat reply (host):
                                  ``{"type":"chat-reply","role":"assistant",
                                  "content":"..."}``
    ``stop-recording``  JSON      Flush pending audio buffer.
    ``init-state``      JSON      Phone sends current state for context.
    ==================  ========  ==========================================

    **Server → Client:**

    ==================  ==========================================
    Message type        Description
    ==================  ==========================================
    ``connected``       Connection acknowledged with session info.
    ``state``           ``CookingSessionState`` update (to phone).
    ``transcript``      Live transcript: ``{text, final}``.
    ``intent``          ``ChefIntentResponse`` from voice command.
    ``voice-intent``    Intent forwarded to host from phone voice.
    ``chat-reply``      Chat answer relayed from host to phone.
    ``peer-joined``     The other role connected to the session.
    ``peer-left``       The other role disconnected.
    ``error``           Error message.
    ==================  ==========================================
    """
    await websocket.accept()

    role = "phone"
    vad = VoiceActivityDetector()
    audio_buffer = WebmAccumulator()

    try:
        # ── Handshake: wait for init message ────────────────────────
        try:
            init_data = await asyncio.wait_for(
                websocket.receive_json(), timeout=10.0
            )
        except asyncio.TimeoutError:
            await _safe_send_json(
                websocket, {"type": "error", "message": "Init timeout — send an init message within 10 s."}
            )
            await websocket.close(code=4000, reason="init_timeout")
            return

        role = init_data.get("role", "phone")

        if role == "phone":
            await _registry.register_phone(session_id, websocket)

            # Push cached session state immediately so the phone doesn't
            # stare at a loading spinner while the PC hasn't pushed yet.
            stored = _registry.get_state(session_id)
            if stored:
                await _safe_send_json(
                    websocket, {"type": "state", "payload": stored}
                )

            # If the phone sent its own state snapshot, cache it
            if "state" in init_data and init_data["state"]:
                _registry.set_state(session_id, init_data["state"])

            # Notify the host that the phone has arrived
            host_ws = _registry.get_host(session_id)
            if host_ws:
                await _safe_send_json(
                    host_ws, {"type": "peer-joined", "role": "phone"}
                )

        elif role == "host":
            await _registry.register_host(session_id, websocket)

            # Cache the initial state if provided
            if "state" in init_data and init_data["state"]:
                _registry.set_state(session_id, init_data["state"])
                # Relay immediately to a connected phone
                phone_ws = _registry.get_phone(session_id)
                if phone_ws:
                    await _safe_send_json(
                        phone_ws,
                        {"type": "state", "payload": init_data["state"]},
                    )

            # Notify the phone that the host arrived, and tell the host
            # the phone is already present (handles host reconnect / phone-first
            # join order).
            phone_ws = _registry.get_phone(session_id)
            if phone_ws:
                await _safe_send_json(
                    phone_ws, {"type": "peer-joined", "role": "host"}
                )
                # Push any cached state to the phone now that the host is back
                cached = _registry.get_state(session_id)
                if cached and "state" not in init_data:
                    await _safe_send_json(
                        phone_ws, {"type": "state", "payload": cached}
                    )
                # Tell the host that the phone is already in the session so it
                # immediately sets phoneConnected=true and pushes fresh state.
                await _safe_send_json(
                    websocket, {"type": "peer-joined", "role": "phone"}
                )

        await _safe_send_json(
            websocket,
            {"type": "connected", "session_id": session_id, "role": role},
        )

        # ── Main message loop ──────────────────────────────────────
        while True:
            message = await websocket.receive()

            # Guard against unexpected disconnects
            ws_type = message.get("type", "")
            if ws_type == "websocket.disconnect":
                break

            # ── Binary frame: audio chunk from phone ────────────────
            if "bytes" in message and message["bytes"]:
                chunk = message["bytes"]                
                # Client-side VAD sending complete utterance in WAV format.
                if chunk.startswith(b"RIFF"):
                    asyncio.create_task(_handle_utterance(websocket, session_id, chunk))
                    continue

                # Continuous streaming (WebM) with backend VAD.                audio_buffer.extend(chunk)

                # VAD decides when an utterance is complete
                if vad.feed_chunk(chunk):
                    utterance_bytes = audio_buffer.flush()
                    # Process in background so the receive loop isn't blocked
                    asyncio.create_task(
                        _handle_utterance(websocket, session_id, utterance_bytes)
                    )

            # ── Text frame: JSON control message ────────────────────
            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                except (json.JSONDecodeError, TypeError):
                    continue

                msg_type = data.get("type")

                if msg_type == "stop-recording":
                    # Client stopped the mic — flush any pending audio
                    if vad.force_flush() and audio_buffer:
                        utterance_bytes = audio_buffer.flush()
                        asyncio.create_task(
                            _handle_utterance(
                                websocket, session_id, utterance_bytes
                            )
                        )
                    vad.reset()
                    audio_buffer.reset()  # New recording = new WebM header

                elif msg_type == "action":
                    # Structured button action from phone → relay to host PC
                    host_ws = _registry.get_host(session_id)
                    if host_ws:
                        await _safe_send_json(host_ws, data)

                elif msg_type == "chat":
                    # Chat question from phone → relay to host for LLM Q&A
                    host_ws = _registry.get_host(session_id)
                    if host_ws:
                        await _safe_send_json(host_ws, data)

                elif msg_type == "state":
                    # State push from host → cache and relay to phone
                    payload = data.get("payload", {})
                    _registry.set_state(session_id, payload)
                    phone_ws = _registry.get_phone(session_id)
                    if phone_ws and phone_ws is not websocket:
                        await _safe_send_json(
                            phone_ws, {"type": "state", "payload": payload}
                        )

                elif msg_type == "chat-reply":
                    # Chat reply from host → relay to phone
                    phone_ws = _registry.get_phone(session_id)
                    if phone_ws and phone_ws is not websocket:
                        await _safe_send_json(phone_ws, data)

                elif msg_type == "ping":
                    await _safe_send_json(websocket, {"type": "pong"})

                elif msg_type == "init-state":
                    # Phone sending its current state for intent context
                    state = data.get("state", {})
                    if state:
                        _registry.set_state(session_id, state)

    except WebSocketDisconnect:
        logger.info(
            "Voice WS disconnected: session=%s role=%s", session_id, role
        )
    except Exception as exc:
        logger.exception(
            "Voice WS error: session=%s role=%s: %s", session_id, role, exc
        )
    finally:
        # Flush any remaining audio on disconnect
        if vad.force_flush() and audio_buffer:
            try:
                await _handle_utterance(
                    websocket, session_id, audio_buffer.flush()
                )
            except Exception:
                pass

        await _registry.unregister(session_id, role)

        # Notify the paired connection
        other_ws = (
            _registry.get_host(session_id)
            if role == "phone"
            else _registry.get_phone(session_id)
        )
        if other_ws:
            await _safe_send_json(
                other_ws, {"type": "peer-left", "role": role}
            )
