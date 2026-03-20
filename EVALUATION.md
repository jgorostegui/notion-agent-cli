# Evaluation: Why Task-Level Interfaces Reduce Agent Cost

This evaluation is about agent interface design, not just Notion.

The central claim is simple: when an agent has to operate too close to a raw API, it spends extra turns planning, extra tokens carrying verbose tool output forward, and extra effort reconstructing workflows that should have been expressed as one action. In this repository, Notion is the case study used to test that claim.

We compared two interface shapes:

- the official Notion MCP path, which exposes endpoint-level tools and raw JSON
- `notion-agent-cli` (NAC), which exposes task-level actions and returns markdown by default

Across 160 valid benchmark sessions, NAC reduced mean turns from 6.56 to 2.61 and total reported cost from $19.41 to $5.74, roughly a 70% reduction. The gain was largest on compound tasks such as “query and report” and “merge multiple pages.” One important exception remained: on Opus 4.6, the `Copy+Modify` scenario was effectively tied.

These results should be read as directional evidence about interface shape. They are not a final scientific claim, and they do not yet amount to a publication-grade correctness proof.

## Why This Matters

Most discussion about agent tooling starts from transport and interoperability: MCP, plugins, tool schemas, JSON contracts. Those matter, but they are not the whole story.

The more immediate question is often simpler:

> What abstraction level is the model being forced to think in?

If the model has to assemble low-level payloads, paginate through bulky responses, and manually coordinate multi-step workflows, the cost of the session goes up even if the underlying API is fast. The problem is not only latency. It is decision count, context growth, and replayed tool output.

That is why this benchmark matters beyond Notion. Notion happens to make the problem visible because it combines nested document structure, verbose payloads, read-modify-write loops, and common compound tasks. But the underlying lesson is broader: interface shape changes agent behavior.

## The Notion Case Study

Notion is a useful testbed because it exposes a pattern that shows up in many agent systems:

- reads can be structurally noisy
- writes often require precise multi-step transformations
- compound tasks are common
- low-level tool calls compose poorly when the model has to do the orchestration

In practice, that means the same user intent can be expressed in two very different ways.

Under an endpoint-level interface, a task like “query a database and write a report” can become a chain of low-level fetches, transformations, and write calls. Under a task-level interface, the same task can often collapse into something closer to `queryDatabase -> createPage`.

The benchmark asks whether that reduction in abstraction overhead shows up in turns and cost.

## Headline Result

The short answer is yes.

| Model | NAC avg turns | MCP avg turns | NAC total cost | MCP total cost | Saving |
|---|---:|---:|---:|---:|---:|
| Sonnet 4.6 | 2.5 | 5.9 | $1.74 | $7.17 | 76% |
| Opus 4.6 | 2.7 | 7.2 | $4.00 | $12.25 | 67% |

Across both models together:

- mean turns fell from 6.56 to 2.61
- total reported cost fell from $19.41 to $5.74
- the largest savings appeared in the most composition-heavy tasks

The strongest wins appeared when the model would otherwise have to coordinate several low-level operations. The two clearest examples were:

- `Query+Report`
- `Merge Pages`

The main counterexample was also informative. On Opus 4.6, `Copy+Modify` was effectively tied, with NAC slightly more expensive on average. That suggests the interface advantage depends not only on what actions exist, but also on whether the model selects the intended higher-level path.

![Mean session cost by scenario (+/- SD)](benchmark/assets/bench-turns-cost.png)

*Figure 1. Mean session cost by scenario across Sonnet 4.6 and Opus 4.6. Error bars show mean +/- 1 SD over 5 runs per condition. The widest gaps appear when the MCP path forces the model into longer, lower-level workflows.*

## Why The Gap Appears

Three mechanisms appear to drive most of the difference.

### 1. Fewer turns

Task-level actions compress workflows.

Instead of asking the model to discover and coordinate each step itself, the interface gives it a smaller number of meaningful verbs. That matters because every extra turn replays more of the conversation. Cost is not just about the current step; it is about the growing history that has to be carried into later steps.

### 2. Less context drag

NAC returns markdown by default. MCP returns raw Notion JSON.

That difference is not just aesthetic. It changes how much bulky structure gets pulled into later turns. Smaller, more legible tool output keeps the working context lighter and reduces the amount of material the model has to mentally reparse.

![Context growth per turn in representative scenarios](benchmark/assets/bench-cumulative.png)

*Figure 2. Cumulative billed input tokens across representative scenarios. The MCP condition becomes more expensive not only because it uses more turns, but because later turns must replay increasingly large contexts.*

### 3. Better alignment between task and tool

The advantage grows with structural complexity.

On simple tasks, a low-level interface is often merely inconvenient. On compound tasks, it becomes expensive. The benchmark showed the biggest gains when the model needed to compose multiple reads and writes, preserve structure, or batch operations. In those cases, the difference between “API endpoints” and “task-level verbs” becomes material.

## Where The Advantage Weakens

The benchmark did not show a uniform win in every case.

The `Copy+Modify` tie on Opus 4.6 matters because it shows the limit of the argument. A higher-level interface does not automatically guarantee a cheaper session. The model still has to choose the right action and stay on the intended path. Interface design and action selection remain coupled variables.

That is also visible in the workflow analysis:

- Sonnet NAC matched the intended workflow in 40 of 40 sessions
- Opus NAC matched it in 36 of 40 sessions
- all four Opus misses occurred in `Copy+Modify`

So the lesson is not “higher-level is always better.” The lesson is narrower and more defensible: when the higher-level path is both available and selected, it usually reduces the amount of reasoning and context replay the agent has to pay for.

## What Was Actually Measured

This repository benchmarked the two interfaces under shared conditions:

- the same Notion workspace
- the same prompts
- the same fixtures
- a fixture reset before every run
- 8 scenarios spanning simple and compound agent work
- 5 iterations per scenario, per condition, per model

That produced 160 valid sessions in the final comparison.

The benchmark was designed to compare interface efficiency, not tool discovery. MCP tool schemas are surfaced by the framework. To make the NAC condition comparable, the benchmark injected the contents of `SKILL.md` directly into the prompt. That equalized tool knowledge and made the comparison answer a narrower question:

> Once the model already knows how to use the interface, how expensive is that interface?

This is an important constraint on interpretation. The benchmark does not describe a natural first-contact session.

Detailed fixtures, scenario definitions, runner commands, and reproduction steps are documented in [benchmark/BENCHMARK.md](benchmark/BENCHMARK.md).

## Limits

Several limits constrain how broadly these results should be interpreted.

- The NAC condition is prompt-injected, so the benchmark removes the normal discovery tax.
- Correctness automation is not yet fully wired into the default runner.
- The property-check path in `benchmark/validate-session.mjs` still needs tightening for some scenarios.
- The fixtures come from a single workspace and are moderate in scale.
- The sample is still relatively small at 5 runs per scenario and condition.
- Each model comparison is based on one main run ID rather than repeated runs across multiple days or environments.

So the current evidence is strong enough to support the design claim, but not strong enough to support sweeping universal conclusions.

## Reproducibility

The repository stores the benchmark artifacts, including session summaries, transcripts, environment metadata, contamination checks, and NAC behavior analysis.

If you want to understand how the benchmark was run, start with [benchmark/BENCHMARK.md](benchmark/BENCHMARK.md). If you want to inspect the analysis workflow directly, use [benchmark/analysis.ipynb](benchmark/analysis.ipynb).

This document is intentionally narrower. It focuses on what the benchmark means, while the benchmark guide and notebook cover how to reproduce and inspect it in detail.
