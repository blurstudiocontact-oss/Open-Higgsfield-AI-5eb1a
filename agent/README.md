# Image and video agent

A small autonomous agent that turns a brief into a shot list, then generates an image and a video for each shot through the [Muapi.ai](https://muapi.ai) API used by the studio app. It is independent of the web UI and uses only the Python standard library, except the optional `anthropic` package for planning.

## Workflow

1. **Plan**: `--brief` asks Claude for a shot list and writes it to a JSON file. Nothing is generated.
2. **Review**: you read and edit the plan.
3. **Generate**: `--plan` with `--execute` runs the plan. Each shot produces one image and one video. Outputs and a `manifest.json` go to `--out-dir`.

The agent does a dry run unless `--execute` is passed. `--max-jobs` is a hard cap on paid generation jobs.

## Usage

```bash
export MUAPI_KEY=...            # required to generate
export ANTHROPIC_API_KEY=...    # required only for --brief

python -m agent.run --brief "A fictional studio creator introduces a new episode" --max-shots 3 --plan-out out/plan.json
python -m agent.run --plan out/plan.json                          # dry run
python -m agent.run --plan out/plan.json --execute --max-jobs 6   # generate
python -m agent.test_agent                                        # tests, no network
```

## Models

- Image: `nano-banana-2` (`endpoint` in `src/lib/models.js`)
- Video: `seedance-lite-t2v` (text-to-video, 480p)

Change `IMAGE_ENDPOINT` and `VIDEO_ENDPOINT` in `agent/run.py` to use other models from the catalog.

## Limits

- Video is text-to-video. The agent does not yet chain the generated image into an image-to-video step.
- The planner's safety rules are instructions to the model, not an enforced filter. Review every plan before using `--execute`.
- Each shot costs two jobs. Check your Muapi credits before a large run.
