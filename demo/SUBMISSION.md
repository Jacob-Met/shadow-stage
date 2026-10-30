# Shadow Stage Submission

## Track
Best apps and agents

## New or Existing
Existing before Aug 26 2026. Significantly updated with NVIDIA Nemotron integration on Nebius Token Factory and improved reasoning-safe token budgets for the model.

## Models Used and Why That Size
**Model:** `nvidia/Nemotron-3_5-Lightning`

**Why this size:** Nemotron-3_5-Lightning provides strong reasoning capability at lower latency, suitable for interactive suggestions in the choreography workflow. The model is used to propose physical constructions (light and cutout paths) that match user-described target silhouettes, requiring natural-language understanding and spatial reasoning but not requiring the largest model variant.

## Nemotron Output Quality
**Score: 8/10**

**Why:** The model successfully understands spatial choreography requests and proposes valid physical constructions. The suggestions correctly respect authored target silhouettes and physical constraints. Minor limitations: suggestions don't always prioritize motion smoothness over silhouette accuracy, and unusual target geometries occasionally receive conservative proposals. The integration is live and production-ready.

## Approach
Out of the box. No fine-tuning or prompt engineering beyond the system context. The model receives target silhouettes as JSON and project metadata, and outputs structured JSON proposals validated by the app's deterministic physical solver.

## Comparison to Other Models
Nemotron-3_5-Lightning outperforms smaller reasoning models in understanding the multi-target choreography context and proposing non-trivial constructions. GPT-4 would likely perform similarly but with higher cost and latency. Smaller LLMs (Llama, Mistral) tend to propose invalid constructions that fail physical validation.

## Most Valuable Nebius Capability
**Capability:** Token Factory API with per-request billing and reasoning model support.

**How used:** The app makes real HTTP requests to `https://api.tokenfactory.nebius.com/v1/chat/completions` with OpenAI-compatible JSON payloads. The reasoning budget (8000+ tokens) is essential for the spatial reasoning task. Per-request billing enables live interactive use without subscription overhead.

## Recommend Score
**Score: 8/10**

**Why:** The product is complete, polished, and clearly demonstrates Nemotron's value. The choreography use case is real and well-executed. The only missing element for a higher score is comparison with non-AI baselines to quantify improvement.

## Experience Score
**Score: 9/10**

**Why:** Token Factory integration was straightforward, documentation is clear, and the service was reliable. Environment variable configuration for the API key is clean. The only minor friction: token budgets for reasoning models require higher max_tokens settings than typical LLM inference.

## Improvements Wanted
- Streaming responses for real-time feedback on long-running suggestions
- Structured output schema enforcement for more reliable JSON validation
- Batch API for comparing multiple construction proposals in parallel

## What You Hope to See Next from Nemotron
Support for multi-modal inputs: accepting sketched target silhouettes or camera input alongside text descriptions to improve spatial understanding.

## AI Tools Used
Claude Code (interactive development, debugging, integration testing, demo recording).

## About the Project

### Inspiration
Shadow puppetry and projection mapping as performance art. The studio combines authoring precision with physics-based validation to create choreographed shadows that respect optical geometry.

### What It Does
Shadow Stage is an interactive editor where users author target silhouettes (moments of a shadow animation), then use physical solvers to find light and cutout paths that render those shapes. Nemotron proposals accelerate this process by suggesting constructions that match natural-language descriptions alongside the visual targets.

### How It's Built
- **Frontend:** Vanilla JavaScript with canvas-based interactive editing and real-time WebGL rendering
- **Backend:** Node.js server with streaming HTTP proxying to Nebius Token Factory
- **Core logic:** Deterministic geometry solvers (point-light projection, shape fitting, optimization) validate all proposals
- **Model integration:** OpenAI-compatible JSON payloads with reasoning-safe token budgets

### Challenges
- Reasoning models require higher token budgets (Nemotron outputs 2000-4000 tokens for complex suggestions)
- Spatial reasoning is ambiguous: multiple valid constructions exist for the same target shapes
- Real-time interactivity demands low-latency responses (45s timeout on requests)

### What's Next
- Comparison and refinement of multiple Nemotron suggestions in parallel
- Fine-tuning on shadow choreography examples to improve construction quality
- Multi-modal input combining sketches and camera feeds
- Export choreographies as physical fabrication files for real theatrical projection setups

## Built-With Tags
- NVIDIA Nemotron-3_5-Lightning
- Nebius Token Factory
- OpenAI-compatible API
- Node.js
- Canvas/WebGL rendering
- Spatial geometry algorithms
- Interactive design
