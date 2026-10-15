"""
Google Gemini LLM client — drop-in replacement for OllamaLLMClient.

Uses the Gemini REST API (Google AI Studio free tier) for structured JSON
parsing and reasoning-heavy tasks like recipe modification and nutrition
estimation.

Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
Auth:     API key as query parameter (?key=...)
Free tier: ~1,500 requests/day for gemini-2.0-flash
"""

import json

import httpx
import requests


class GeminiLLMClient:
    """
    Google Gemini API client with the same 4-method interface as OllamaLLMClient.

    Methods:
      - generate / generate_async       → plain text response
      - generate_json / generate_json_async → JSON mode (responseMimeType)
    """

    _BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
    _TIMEOUT = 120

    def __init__(self, api_key: str, model: str = "gemini-2.0-flash"):
        if not api_key:
            raise ValueError(
                "Gemini API key is required. Set GEMINI_API_KEY in your .env file. "
                "Get a free key at https://aistudio.google.com/apikey"
            )
        self.model = model
        self._api_key = api_key

    def _url(self) -> str:
        return f"{self._BASE_URL}/{self.model}:generateContent?key={self._api_key}"

    def _build_payload(self, prompt: str, *, json_mode: bool = False) -> dict:
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 512,
            },
        }
        if json_mode:
            payload["generationConfig"]["responseMimeType"] = "application/json"
        return payload

    def _extract_content(self, data: dict) -> str:
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()

    # ── Text generation ──────────────────────────────────────────────────

    def generate(self, prompt: str) -> str:
        response = requests.post(
            self._url(),
            json=self._build_payload(prompt),
            timeout=self._TIMEOUT,
        )
        response.raise_for_status()
        return self._extract_content(response.json())

    async def generate_async(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=self._TIMEOUT) as client:
            response = await client.post(
                self._url(),
                json=self._build_payload(prompt),
            )
            response.raise_for_status()
            return self._extract_content(response.json())

    # ── Structured JSON generation ───────────────────────────────────────

    def generate_json(self, prompt: str) -> dict:
        response = requests.post(
            self._url(),
            json=self._build_payload(prompt, json_mode=True),
            timeout=self._TIMEOUT,
        )
        response.raise_for_status()
        raw = self._extract_content(response.json())
        return json.loads(raw)

    async def generate_json_async(self, prompt: str) -> dict:
        async with httpx.AsyncClient(timeout=self._TIMEOUT) as client:
            response = await client.post(
                self._url(),
                json=self._build_payload(prompt, json_mode=True),
            )
            response.raise_for_status()
            raw = self._extract_content(response.json())
            return json.loads(raw)
