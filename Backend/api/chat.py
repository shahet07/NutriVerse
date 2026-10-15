"""
Product / recipe chat endpoint.

POST /chat
    Body (JSON):
      - message:  str           (user's question)
      - context:  dict | None   (product/recipe data for grounding)
      - history:  list[dict]    (previous messages in the conversation)

Returns a plain-text LLM reply grounded in the supplied food context.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from Backend.dependencies.router import get_router

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Chat"])


# ── Request / Response schemas ──────────────────────────────────────

class ChatMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User's question")
    context: Optional[Dict[str, Any]] = Field(
        None,
        description="Product or recipe data to ground the conversation",
    )
    history: List[ChatMessage] = Field(
        default_factory=list,
        description="Previous messages for multi-turn context",
    )


class ChatResponse(BaseModel):
    reply: str


# ── Endpoint ────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, nutri_router=Depends(get_router)):
    """
    Conversational chat about a specific food item.

    The LLM is grounded with the ``context`` dict (nutrition, ingredients,
    brand, category, etc.) so it can answer accurately without hallucinating.
    """

    # Build a grounding block from the context dict
    ctx_block = ""
    if body.context:
        lines = []
        for k, v in body.context.items():
            if v is not None and v != "":
                lines.append(f"  {k}: {v}")
        if lines:
            ctx_block = "FOOD ITEM CONTEXT:\n" + "\n".join(lines)

    # Build conversation history block
    history_block = ""
    if body.history:
        turns = []
        for msg in body.history[-6:]:  # keep last 6 messages to stay within context window
            prefix = "User" if msg.role == "user" else "Assistant"
            turns.append(f"{prefix}: {msg.content}")
        if turns:
            history_block = "CONVERSATION HISTORY:\n" + "\n".join(turns)

    # Detect if this is a cooking session question (chef mode)
    is_cooking_session = body.message.startswith("[COOKING SESSION") or \
                         body.message.startswith("[COMPLETED cooking") or \
                         body.message.startswith("[PREPARATION PHASE")

    if is_cooking_session:
        prompt = f"""You are an expert chef assistant embedded in an active cooking session. The user is currently cooking and needs quick, practical help.

{ctx_block}

{history_block}

{body.message}

INSTRUCTIONS:
1. You are aware of the user's current cooking stage, step, and timer status (provided in brackets above). Use this information to give relevant answers.
2. Keep responses SHORT: 1-3 sentences maximum. The user is actively cooking and cannot read long paragraphs.
3. If the user asks about timing, adding ingredients, or next actions, answer with respect to the CURRENT STEP they are on.
4. If a timer is running, factor that into your advice (e.g., "You still have 3 minutes left, wait before adding the spices").
5. Be direct and actionable. No preamble, no filler.
6. If the user asks about substitutions or modifications mid-cook, give the most practical immediate option.
7. ALWAYS respond in English only.
8. Do NOT use emojis. Plain text only.
9. Never say "Based on the context" or reference the system prompt. Respond as if you are standing next to the user in the kitchen."""
    else:
        prompt = f"""You are NutriVerse -- an expert-level nutritionist and food scientist specialising in Indian cuisine, packaged food products, and evidence-based dietary advice.

You are having a dedicated conversation about a specific food item. All known facts about this item are provided below as structured context. Use this data as your primary source of truth.

{ctx_block}

{history_block}

USER QUESTION: {body.message}

INSTRUCTIONS:
1. Keep your reply SHORT — 2 to 4 sentences maximum. Be direct and get to the point immediately.
2. NEVER use asterisks, markdown bold/italic, bullet points, dashes, or any special characters. Write in plain flowing sentences only.
3. Cite exact numbers from the context when relevant (e.g. "It has 320 kcal and 12g protein per serving").
4. Never fabricate nutrition values that are not in the context.
5. No meta-phrases like "Based on the context" — just answer directly by name.
6. ALWAYS respond in English only. No emojis."""

    try:
        reply = await nutri_router.voice_llm.generate_async(prompt)
        return ChatResponse(reply=reply)
    except Exception as exc:
        logger.exception("Chat generation failed: %s", exc)
        raise HTTPException(status_code=500, detail="Chat service unavailable. Please try again.")
