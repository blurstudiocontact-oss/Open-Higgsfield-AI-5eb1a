import json
import os
import tempfile
import unittest
from unittest import mock

from agent import run
from agent.muapi import MuapiClient, MuapiError, sniff_format
from agent.planner import parse_plan

def fake_download(url, path):
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + b"0" * 8)


def _write(path, data):
    with open(path, "wb") as f:
        f.write(data)


GOOD_PLAN = {
    "shots": [
        {"id": "s1", "image_prompt": "a fictional studio", "video_prompt": "slow push-in",
         "aspect_ratio": "9:16", "duration": 5},
    ]
}


class FakeClient(MuapiClient):
    """Replaces HTTP with scripted responses. Records every submitted endpoint."""

    def __init__(self, responses):
        super().__init__(api_key="test", poll_interval=0)
        self.responses = list(responses)
        self.submitted = []

    def _request(self, method, path, payload=None):
        if method == "POST":
            self.submitted.append(path)
        return self.responses.pop(0)


class MuapiClientTests(unittest.TestCase):
    def test_requires_api_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(MuapiError):
                MuapiClient()

    def test_generate_polls_until_completed(self):
        client = FakeClient([
            {"request_id": "r1"},
            {"status": "processing"},
            {"status": "completed", "outputs": ["https://cdn.example/out.jpg"]},
        ])
        with mock.patch("time.sleep"):
            result = client.generate("nano-banana-2", {"prompt": "x"})
        self.assertEqual(result["url"], "https://cdn.example/out.jpg")
        self.assertEqual(client.submitted, ["/api/v1/nano-banana-2"])

    def test_failed_status_raises(self):
        client = FakeClient([{"request_id": "r1"}, {"status": "failed", "error": "bad prompt"}])
        with mock.patch("time.sleep"), self.assertRaises(MuapiError):
            client.generate("nano-banana-2", {"prompt": "x"})

    def test_result_without_output_url_raises(self):
        with self.assertRaises(MuapiError):
            MuapiClient._normalize({"status": "completed"})


class PlanParsingTests(unittest.TestCase):
    def test_accepts_valid_plan_wrapped_in_prose(self):
        text = "Here is the plan: " + json.dumps(GOOD_PLAN) + " Done."
        self.assertEqual(parse_plan(text, max_shots=3), GOOD_PLAN)

    def test_rejects_too_many_shots(self):
        with self.assertRaises(ValueError):
            parse_plan(json.dumps(GOOD_PLAN), max_shots=0)

    def test_rejects_unsupported_aspect_ratio(self):
        bad = json.loads(json.dumps(GOOD_PLAN))
        bad["shots"][0]["aspect_ratio"] = "2:1"
        with self.assertRaises(ValueError):
            parse_plan(json.dumps(bad), max_shots=3)

    def test_rejects_missing_json(self):
        with self.assertRaises(ValueError):
            parse_plan("no plan here", max_shots=3)


class ImageFormatTests(unittest.TestCase):
    def _sniff(self, header):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(header)
        try:
            return sniff_format(f.name)
        finally:
            os.remove(f.name)

    def test_recognises_common_formats(self):
        self.assertEqual(self._sniff(b"\x89PNG\r\n\x1a\n" + b"0" * 8), "png")
        self.assertEqual(self._sniff(b"\xff\xd8\xff\xe0" + b"0" * 12), "jpeg")
        self.assertEqual(self._sniff(b"RIFF" + b"0000" + b"WEBP"), "webp")

    def test_recognises_avif_and_mp4(self):
        self.assertEqual(self._sniff(b"\x00\x00\x00\x1cftypavif" + b"0" * 4), "avif")
        self.assertEqual(self._sniff(b"\x00\x00\x00\x18ftypmp42"), "mp4")

    def test_avif_is_converted_to_png(self):
        client = mock.Mock()
        client.download.side_effect = lambda url, path: _write(path, b"\x00\x00\x00\x1cftypavif0000")
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch("agent.run.shutil.which", return_value="/usr/bin/ffmpeg"), \
             mock.patch("agent.run.subprocess.run") as run_ffmpeg:
            path = run.save_image(client, "https://cdn.example/a.avif", os.path.join(tmp, "s1"))
        self.assertTrue(path.endswith(".png"))
        self.assertEqual(run_ffmpeg.call_args[0][0][-1], path)


class BudgetAndRunTests(unittest.TestCase):
    def test_budget_stops_after_limit(self):
        budget = run.Budget(max_jobs=1)
        budget.spend()
        with self.assertRaises(run.BudgetExceeded):
            budget.spend()

    def test_dry_run_makes_no_requests(self):
        client = FakeClient([])
        with tempfile.TemporaryDirectory() as tmp:
            run.run_plan(GOOD_PLAN, tmp, client, run.Budget(0), execute=False, log=lambda *_: None)
        self.assertEqual(client.submitted, [])

    def test_execute_generates_image_and_video_then_writes_manifest(self):
        client = FakeClient([
            {"outputs": ["https://cdn.example/a.jpg"]},
            {"outputs": ["https://cdn.example/a.mp4"]},
        ])
        client.download = mock.Mock(side_effect=fake_download)
        with tempfile.TemporaryDirectory() as tmp:
            manifest = run.run_plan(GOOD_PLAN, tmp, client, run.Budget(2), execute=True, log=lambda *_: None)
            self.assertTrue(os.path.exists(os.path.join(tmp, "manifest.json")))
        self.assertEqual(client.submitted, ["/api/v1/nano-banana-2", "/api/v1/seedance-lite-t2v"])
        self.assertEqual(len(manifest), 1)
        self.assertEqual(client.download.call_count, 2)

    def test_execute_respects_job_cap_before_second_job(self):
        client = FakeClient([{"outputs": ["https://cdn.example/a.jpg"]}])
        client.download = mock.Mock(side_effect=fake_download)
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(run.BudgetExceeded):
            run.run_plan(GOOD_PLAN, tmp, client, run.Budget(1), execute=True, log=lambda *_: None)
        self.assertEqual(client.submitted, ["/api/v1/nano-banana-2"])


if __name__ == "__main__":
    unittest.main()
