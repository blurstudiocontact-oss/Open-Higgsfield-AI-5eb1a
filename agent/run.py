"""Autonomous image and video agent: brief -> plan -> (optional, budgeted) generation.

Dry run by default. Nothing is generated unless --execute is passed.

    python -m agent.run --brief "..." --plan-out out/plan.json       # plan only
    python -m agent.run --plan out/plan.json --execute --max-jobs 6  # generate
"""
import argparse
import json
import os
import sys

import shutil
import subprocess

from agent.muapi import MuapiClient, MuapiError, sniff_format
from agent.planner import plan_brief

IMAGE_ENDPOINT = "nano-banana-2"  # text-to-image, from src/lib/models.js
VIDEO_ENDPOINT = "seedance-lite-t2v"  # text-to-video, from src/lib/models.js
ACCEPTED_IMAGE_FORMATS = {"png": ".png", "jpeg": ".jpg", "gif": ".gif", "webp": ".webp"}


def save_image(client, url, base_path):
    """Download an image and store it in a format the image APIs accept (PNG if conversion is needed)."""
    raw = base_path + ".download"
    client.download(url, raw)
    fmt = sniff_format(raw)
    if fmt in ACCEPTED_IMAGE_FORMATS:
        final = base_path + ACCEPTED_IMAGE_FORMATS[fmt]
        os.replace(raw, final)
        return final
    if not shutil.which("ffmpeg"):
        os.remove(raw)
        raise MuapiError(f"image is {fmt}, which needs ffmpeg to convert to PNG; install ffmpeg")
    final = base_path + ".png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, final], check=True)
    os.remove(raw)
    return final


class BudgetExceeded(RuntimeError):
    pass


class Budget:
    def __init__(self, max_jobs):
        self.max_jobs = max_jobs
        self.used = 0

    def spend(self):
        if self.used >= self.max_jobs:
            raise BudgetExceeded(f"job limit of {self.max_jobs} reached")
        self.used += 1


def run_plan(plan, out_dir, client, budget, execute, log=print):
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    for shot in plan["shots"]:
        entry = {"id": shot["id"], "image": None, "video": None}
        if not execute:
            log(f"[dry run] {shot['id']}: image '{shot['image_prompt'][:60]}' + video '{shot['video_prompt'][:60]}'")
            manifest.append(entry)
            continue

        budget.spend()
        image = client.generate(
            IMAGE_ENDPOINT, {"prompt": shot["image_prompt"], "aspect_ratio": shot["aspect_ratio"]}
        )
        entry["image"] = save_image(client, image["url"], os.path.join(out_dir, shot["id"]))
        log(f"{shot['id']}: image saved to {entry['image']}")

        budget.spend()
        video = client.generate(
            VIDEO_ENDPOINT,
            {
                "prompt": shot["video_prompt"],
                "aspect_ratio": shot["aspect_ratio"],
                "duration": int(shot["duration"]),
                "resolution": "480p",
            },
        )
        entry["video"] = os.path.join(out_dir, f"{shot['id']}.mp4")
        client.download(video["url"], entry["video"])
        log(f"{shot['id']}: video saved to {entry['video']}")

        manifest.append(entry)
        with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--brief", help="free-text brief for the planner (needs ANTHROPIC_API_KEY)")
    source.add_argument("--plan", help="path to a reviewed plan JSON")
    parser.add_argument("--plan-out", help="where to write the generated plan for review")
    parser.add_argument("--max-shots", type=int, default=3)
    parser.add_argument("--out-dir", default="out")
    parser.add_argument("--execute", action="store_true", help="actually spend credits")
    parser.add_argument("--max-jobs", type=int, default=4, help="hard cap on generation jobs")
    args = parser.parse_args(argv)

    if args.brief:
        plan = plan_brief(args.brief, args.max_shots)
        plan_path = args.plan_out or os.path.join(args.out_dir, "plan.json")
        os.makedirs(os.path.dirname(plan_path) or ".", exist_ok=True)
        with open(plan_path, "w", encoding="utf-8") as f:
            json.dump(plan, f, indent=2, ensure_ascii=False)
        print(f"Plan written to {plan_path}. Review it, then run again with --plan and --execute.")
        return 0

    with open(args.plan, encoding="utf-8") as f:
        plan = json.load(f)
    if not args.execute:
        run_plan(plan, args.out_dir, client=None, budget=Budget(args.max_jobs), execute=False)
        print("Dry run complete. Add --execute to generate. Each shot costs two jobs.")
        return 0

    try:
        client = MuapiClient()
    except MuapiError as err:
        print(err, file=sys.stderr)
        return 1
    try:
        run_plan(plan, args.out_dir, client, Budget(args.max_jobs), execute=True)
    except (BudgetExceeded, MuapiError) as err:
        print(f"Stopped: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
