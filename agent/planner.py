"""Turns a free-text brief into a shot list. The plan is reviewed by a human before anything is generated."""
import json

DEFAULT_PLANNER_MODEL = "claude-haiku-5-5"
ALLOWED_ASPECT_RATIOS = {"1:1", "16:9", "9:16", "4:3", "3:4"}

SYSTEM_PROMPT = """You plan short image and video shots for a creative brief.
Return only a JSON object: {"shots": [{"id": str, "image_prompt": str, "video_prompt": str, "aspect_ratio": str, "duration": int}]}
Rules:
- Depict only fictional or generic subjects. Never depict a real, identifiable person, a public figure, or a brand's spokesperson.
- No sexual content, no nudity, and no minors in any shot.
- aspect_ratio must be one of 1:1, 16:9, 9:16, 4:3, 3:4. duration is 3 to 10 seconds."""


def parse_plan(text, max_shots):
    """Extract and validate the JSON plan from a model reply."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("planner reply contains no JSON object")
    plan = json.loads(text[start : end + 1])
    shots = plan.get("shots")
    if not isinstance(shots, list) or not shots:
        raise ValueError("plan has no shots")
    if len(shots) > max_shots:
        raise ValueError(f"plan has {len(shots)} shots, above the limit of {max_shots}")
    for shot in shots:
        for key in ("id", "image_prompt", "video_prompt", "aspect_ratio", "duration"):
            if key not in shot:
                raise ValueError(f"shot {shot.get('id', '?')} is missing {key}")
        if shot["aspect_ratio"] not in ALLOWED_ASPECT_RATIOS:
            raise ValueError(f"shot {shot['id']} has unsupported aspect ratio {shot['aspect_ratio']}")
        if not 3 <= int(shot["duration"]) <= 10:
            raise ValueError(f"shot {shot['id']} duration must be 3 to 10 seconds")
    return {"shots": shots}


def plan_brief(brief, max_shots, model=DEFAULT_PLANNER_MODEL, client=None):
    """Ask Claude for a shot list. `client` is injectable for tests."""
    if client is None:
        import anthropic  # optional dependency, needed only for planning

        client = anthropic.Anthropic()
    reply = client.messages.create(
        model=model,
        max_tokens=2000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Brief: {brief}\nMaximum shots: {max_shots}"}],
    )
    return parse_plan(reply.content[0].text, max_shots)
