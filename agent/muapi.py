"""Minimal Muapi.ai client. Mirrors the submit-then-poll flow in src/lib/muapi.js."""
import json
import os
import time
import urllib.error
import urllib.request

BASE_URL = "https://api.muapi.ai"
DONE_STATUSES = {"completed", "succeeded", "success"}
FAILED_STATUSES = {"failed", "error"}


class MuapiError(RuntimeError):
    pass


class MuapiClient:
    def __init__(self, api_key=None, base_url=BASE_URL, poll_interval=2.0, max_polls=90):
        self.api_key = api_key or os.environ.get("MUAPI_KEY")
        if not self.api_key:
            raise MuapiError("MUAPI_KEY is not set")
        self.base_url = base_url.rstrip("/")
        self.poll_interval = poll_interval
        self.max_polls = max_polls

    def _request(self, method, path, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", "x-api-key": self.api_key},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as err:
            body = err.read().decode(errors="replace")[:200]
            raise MuapiError(f"{method} {path} failed: {err.code} {body}") from err

    def generate(self, endpoint, payload):
        """Submit a job and return the finished result with a normalized `url`."""
        submitted = self._request("POST", f"/api/v1/{endpoint}", payload)
        request_id = submitted.get("request_id") or submitted.get("id")
        if not request_id:
            return self._normalize(submitted)
        return self._normalize(self.wait(request_id))

    def wait(self, request_id):
        path = f"/api/v1/predictions/{request_id}/result"
        last_error = None
        for _ in range(self.max_polls):
            time.sleep(self.poll_interval)
            try:
                data = self._request("GET", path)
            except MuapiError as err:
                last_error = err  # transient failures are retried, as in muapi.js
                continue
            status = str(data.get("status", "")).lower()
            if status in DONE_STATUSES:
                return data
            if status in FAILED_STATUSES:
                raise MuapiError(f"generation failed: {data.get('error', 'unknown error')}")
        raise MuapiError(f"generation timed out after {self.max_polls} polls") from last_error

    @staticmethod
    def _normalize(result):
        outputs = result.get("outputs") or []
        url = (outputs[0] if outputs else None) or result.get("url") or (result.get("output") or {}).get("url")
        if not url:
            raise MuapiError("result has no output URL")
        return {**result, "url": url}

    @staticmethod
    def download(url, path):
        with urllib.request.urlopen(url, timeout=120) as resp, open(path, "wb") as out:
            out.write(resp.read())
