import json
import requests
import httpx


class OllamaLLMClient:
    """
    Local free LLM client using Ollama (STABLE VERSION)
    Supports both synchronous (requests) and asynchronous (httpx) generation.

    Two generation modes:
      - generate / generate_async      â†’ plain text response
      - generate_json / generate_json_async â†’ Ollama JSON mode (format="json")
        The model is forced to emit valid JSON; the result is parsed and
        returned as a Python dict.  Prompt should describe the expected schema.
    """

    _OPTIONS = {
        "temperature": 0.3,
        "num_ctx": 2048,
        "num_predict": 512,
    }
    _TIMEOUT = 120

    def __init__(self, model: str = "llama3.2"):
        self.model = model
        self.url = "http://localhost:11434/api/generate"

    def _build_payload(self, prompt: str, *, json_mode: bool = False) -> dict:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": self._OPTIONS,
        }
        if json_mode:
            payload["format"] = "json"
        return payload

    # â”€â”€ Text generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def generate(self, prompt: str) -> str:
        response = requests.post(
            self.url,
            json=self._build_payload(prompt),
            timeout=self._TIMEOUT,
        )
        response.raise_for_status()
        return response.json()["response"].strip()

    async def generate_async(self, prompt: str) -> str:
        """Async variant using httpx â€” does not block the event loop."""
        async with httpx.AsyncClient(timeout=self._TIMEOUT) as client:
            response = await client.post(
                self.url, json=self._build_payload(prompt)
            )
            response.raise_for_status()
            return response.json()["response"].strip()

    # â”€â”€ Structured JSON generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def generate_json(self, prompt: str) -> dict:
        """
        Call Ollama with ``format='json'`` and return the parsed dict.
        The model is constrained to emit valid JSON; no manual string-splitting
        is needed.  Raises ``json.JSONDecodeError`` if the response is not
        valid JSON (should not happen with Ollama JSON mode, but guards exist
        in the engine layer).
        """
        response = requests.post(
            self.url,
            json=self._build_payload(prompt, json_mode=True),
            timeout=self._TIMEOUT,
        )
        response.raise_for_status()
        raw = response.json()["response"].strip()
        return json.loads(raw)

    async def generate_json_async(self, prompt: str) -> dict:
        """Async variant of generate_json â€” does not block the event loop."""
        async with httpx.AsyncClient(timeout=self._TIMEOUT) as client:
            response = await client.post(
                self.url, json=self._build_payload(prompt, json_mode=True)
            )
            response.raise_for_status()
            raw = response.json()["response"].strip()
            return json.loads(raw)
