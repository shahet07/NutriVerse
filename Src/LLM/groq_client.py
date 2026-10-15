"""
Groq cloud LLM client — drop-in replacement for OllamaLLMClient.

Uses the Groq API (OpenAI-compatible chat completions) for fast inference
on open-source models via Groq's LPU hardware.

Endpoint: https://api.groq.com/openai/v1/chat/completions
Auth:     Authorization: Bearer <GROQ_API_KEY>
"""

import json

import httpx
import requests


class GroqLLMClient:
    """
    Groq API client with the same 4-method interface as OllamaLLMClient.

    Methods:
      - generate / generate_async       → plain text response
      - generate_json / generate_json_async → JSON mode (response_format)
    """

    _TIMEOUT = 120

    def __init__(self, api_key: str, model: str = "llama-3.3-70b-versatile"):
        if not api_key:
            raise ValueError(
                "Groq API key is required. Set GROQ_API_KEY in your .env file. "
                "Get a free key at https://console.groq.com"
            )
        self.model = model
        self.url = "https://api.groq.com/openai/v1/chat/completions"
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def _build_payload(self, prompt: str, *, json_mode: bool = False) -> dict:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 1500,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    def _extract_content(self, data: dict) -> str:
        return data["choices"][0]["message"]["content"].strip()

    # ── Text generation ──────────────────────────────────────────────────

    def generate(self, prompt: str) -> str:
        response = requests.post(
            self.url,
            headers=self._headers,
            json=self._build_payload(prompt),
            timeout=self._TIMEOUT,
        )
        response.raise_for_status()
        return self._extract_content(response.json())

    async def generate_async(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=self._TIMEOUT) as client:
            response = await client.post(
                self.url,
                headers=self._headers,
                json=self._build_payload(prompt),
            )
            response.raise_for_status()
            return self._extract_content(response.json())

    # ── Structured JSON generation ───────────────────────────────────────

    def generate_json(self, prompt: str) -> dict:
        response = requests.post(
            self.url,
            headers=self._headers,
            json=self._build_payload(prompt, json_mode=True),
            timeout=self._TIMEOUT,
        )
        response.raise_for_status()
        raw = self._extract_content(response.json())
        return json.loads(raw)

    async def generate_json_async(self, prompt: str) -> dict:
        async with httpx.AsyncClient(timeout=self._TIMEOUT) as client:
            response = await client.post(
                self.url,
                headers=self._headers,
                json=self._build_payload(prompt, json_mode=True),
            )
            response.raise_for_status()
            raw = self._extract_content(response.json())
            return json.loads(raw)
