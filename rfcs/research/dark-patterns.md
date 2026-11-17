# Dark patterns and web agents: what carries over to capability graphs

This note reads one paper closely, for the agent-choice benchmark (milestone 5):

> D. Ersoy, B. Lee, A. Shreekumar, A. Arunasalam, M. Ibrahim, A. Bianchi and Z. B. Celik, "Investigating the Impact of Dark Patterns on LLM-Based Web Agents," IEEE Symposium on Security and Privacy 2026. arXiv:2510.18113. <https://arxiv.org/abs/2510.18113>

**The version read:** v1 (20 October 2025), the only version on arXiv, through its HTML rendering at <https://arxiv.org/html/2510.18113v1>. It was read on 2026-11-17.

- **Venue:** the S&P 2026 acceptance comes from the arXiv comments field ("At IEEE S&P 2026"), the paper's header, and the program committee's meta-review in Appendix G.
- **Code and data:** <https://github.com/purseclab/liteagent> (§I).
- **How to read this note:**
  - "§" is a section of the paper.
  - Quotations are verbatim.
  - Figure values are as printed on the chart, unless marked "about", which means read from the bar height.
  - Sections 1-5 report the paper. Sections 6-9 are our analysis and are labeled as ours.

**Why it matters here.** The paper measures how browser agents respond to deceptive interface design. We want to know whether related effects appear when an agent chooses among fixed, legitimate options presented through a machine-readable capability graph, with no rendered interface. The paper doesn't claim that, and nothing in it establishes it. What we can take from it is a method: toggleable conditions over a fixed task, a paired baseline, trace predicates for outcomes, and the separation of task success from deception.

## 1. What the paper built

**TrickyArena**:

- "a custom testbed of four React-based websites" (§I): e-commerce, news, music streaming and a health portal (§III-A).
- Each site holds "diverse and realistic dark patterns that can be selectively enabled or disabled" (Abstract), switched on by URL parameters (§III-A, §IV-A).
- A scenario is a tuple "S=(T,W,D), which includes a task T on a Website W with a set of dark patterns D={d1,…,dn} where n≥0" (§III-A).
- Every interactive element has "a static and persistent globally unique element ID" (§I).

**LiteAgent** drives an agent through a task and records what it does (§III-B):

- it injects JavaScript event listeners through the Chrome DevTools Protocol and Playwright;
- it logs each click, scroll and keystroke with its element, URL and timing;
- it records the screen.
- It's agent-agnostic: it wraps whole agent implementations, not just a backbone model (§III-B).

**The Agent Action Validator** scores each trace (§III-C): "Each condition involves an action trace database query to determine the existence, non-existence, or uniqueness of a specific action."

- **Task success and falling for the pattern** are each a conjunction of such predicates. For the warranty pattern, "we check if the warranty was added to the cart, was not removed from the cart, and that the checkout button was clicked."
- **Manual review:** the authors reviewed the screen recordings "to confirm reliability". No agreement figure is reported.

**Agents and models** (§IV-B, §V):

- **Agents:** Skyvern, DoBrowser, BrowserUse, Agent-E, WebArena and VisualWebArena.
- **Models:** GPT-4o backs every research question except RQ2. RQ2 compares GPT-4o, Claude 3.7 Sonnet and Gemini 2.5 Pro on three agents (BrowserUse, Skyvern and Agent-E).
- **Not stated:** agent versions, model snapshot identifiers, temperature and seeds.

## 2. The taxonomy

The paper adopts the five high-level categories of Gray, Santos, Bielova and Mildner's ontology of dark patterns (CHI 2024; reference [31] in the paper; §II-B). It takes pattern instances from two published collections ([17], [44]). The definitions, as the paper gives them (§II-B):

| Category                   | Definition (verbatim)                                                                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Obstruction**            | "imped[ing] a user's task flow [by] making an interaction more difficult than it inherently needs to be, dissuading a user from taking an action."                                                                                                                          |
| **Sneaking**               | "hid[ing], disguis[ing], or delay[ing] the disclosure of important information that, if made available to users, would cause a user to unintentionally take an action they would likely object to."                                                                         |
| **Interface interference** | "privileg[ing] specific actions over others through manipulation of the user interface, thereby confusing the user or limiting discoverability of relevant action possibilities."                                                                                           |
| **Forced action**          | "requir[ing] users to knowingly or unknowingly perform an additional and/or tangential action or information to access (or continue to access) specific functionality, preventing them from continuing their interaction with a system without performing that action […]." |
| **Social engineering**     | "present[ing] options or information causing a user to be more likely to perform a specific action."                                                                                                                                                                        |

The forced-action definition as printed continues with wording about social norms that reads like the ontology's social-engineering definition. We've cut it at the bracket.

**The 14 patterns** (Appendix B, Table V) were chosen to have "a measurable goal" and to relate to a chosen task (§III-A). Each has a goal (financial, personal information or attention) and one or more categories. The ones closest to a choice among plans:

- **Sneaking warranty to cart:** a warranty is added without notice. Category: sneaking.
- **Sponsored item appears first:** first "no matter what is searched or how results are sorted". Category: interface interference.
- **Aesthetic manipulation:** "'Best value' is shown on top of that option, even though other options may be better". Categories: interface interference and social engineering.
- **Bait and switch:** an article claims to be free, then asks for a trial sign-up, though "No free trial is needed to view the article." Categories: sneaking, interface interference and forced action.
- **Premium subscription pop-up:** the reject button is "hidden behind 'more options'". Categories: four of the five.

The categories are multi-label. Interface interference covers 13 of the 14 patterns, and sneaking only two. So the per-category rates below overlap heavily.

## 3. Method

**Conditions** (§V-A, §V-C):

- a dark-pattern-free baseline for each task;
- 88 single-pattern scenarios, "ensuring that only one dark pattern is active at a time";
- 57 two-pattern, 18 three-pattern and 4 four-pattern scenarios, compared "on the same site and task" with the single-pattern runs.

**Further experiments:**

- **UI attributes (RQ4):** eight variants of one pattern change its code (UI library, text as images, ARIA removed), its look (color, placement) or both (§V-D, Table VI).
- **Vision (RQ5):** on and off, for three agents (§V-E).
- **Warning prompts:** general, intermediate and specific postscripts added to the task prompt, tested on two scenarios (§VI, Appendix F).

**Trials:** "We run each agent on each scenario three times to account for the stochastic nature of LLM-based web agents" (§V-A).

- Run order, option order, seeds and temperature aren't stated.
- Neither is the total run count.

**Metrics** (§V, Evaluation Metrics):

- **TSR:** "the percentage of tasks that the web agent is able to complete."
- **DPSR**, susceptibility: "the percentage of times that the web agent falls for the dark pattern." Its denominator is all runs, not the runs that reached the pattern.
- **Four mutually exclusive outcomes:**
  - deceived completion (DC);
  - deceived failure (DF);
  - evaded completion (EC), "the ideal outcome" (§V-B);
  - evaded failure (EF).
    So TSR = DC + EC, and susceptibility = DC + DF.

**Statistics** (§V-A, §V-C):

- standardized chi-square residuals on the agent × outcome table;
- relative changes, with Laplace smoothing (ε = 0.5%) for the multi-pattern comparison.
- No confidence intervals, hypothesis tests or effect sizes are reported.

## 4. Findings

**Susceptibility** (single pattern, GPT-4o, six agents; Table I):

| Agent          | Obstruction | Sneaking  | Interface interference | Forced action | Social engineering | Overall   |
| -------------- | ----------- | --------- | ---------------------- | ------------- | ------------------ | --------- |
| Skyvern        | 94.1%       | 74.1%     | 70.3%                  | 82.0%         | 75.0%              | 72.3%     |
| Agent-E        | 13.1%       | 3.7%      | 12.6%                  | 5.8%          | 22.0%              | 12.1%     |
| WebArena       | 14.6%       | 11.1%     | 14.8%                  | 9.6%          | 24.6%              | 14.9%     |
| DoBrowser      | 54.2%       | 48.1%     | 44.3%                  | 46.6%         | 44.7%              | 46.2%     |
| BrowserUse     | 88.9%       | 59.3%     | 67.9%                  | 77.2%         | 78.8%              | 69.3%     |
| VisualWebArena | 39.9%       | 0.0%      | 33.7%                  | 34.4%         | 37.9%              | 31.4%     |
| **Overall**    | **52.2%**   | **33.9%** | **41.7%**              | **43.9%**     | **47.9%**          | **41.1%** |

The abstract rounds the overall rate to 41%. How the overall cells are aggregated isn't stated. The mean of the six agents' rates is 41.0%, so it's likely pooled over runs. Per-pattern rates aren't reported.

**Capable agents fall for more** (§V-A, Finding 1):

- The agents with the highest baseline task success (BrowserUse 76.3%, DoBrowser 73.1%, Skyvern 72.0%; Fig. 5) include the two most susceptible.
- The paper's explanation is that they "prioritize overcoming barriers to complete tasks, even if it means falling for deceptive elements in the process".
- Weaker agents "are not purposefully evading dark patterns but are coincidentally doing so due to poor performance": their failures include "early-exit failure", which "prevents exposure to dark pattern mechanics that are gated behind successful task progression."
- The inverse relation is asserted from six agents. No correlation is computed.

**Obstruction and social engineering are the most effective categories,** at 52.2% and 47.9% (§V-A).

**The model matters, and so does the agent built on it** (§V-B, Table II):

- **Susceptibility, averaged over three agents:**

  | Model             | Susceptibility |
  | ----------------- | -------------- |
  | Gemini 2.5 Pro    | 65.8%          |
  | Claude 3.7 Sonnet | 53.8%          |
  | GPT-4o            | 51.3%          |

- **The same model can rank very differently on different agents:** GPT-4o is the most susceptible pairing on Skyvern and the least on Agent-E.
- The paper's explanation of the model differences is speculative and untested.

**Patterns compound** (§V-C, Finding 3):

- Task success falls as more patterns are enabled.
- Patterns that were inert alone "became effective" in combination.
- In two case studies, an agent that ignored a sponsored ad alone clicked "donate now" once three modals were added.
- The relative changes in Fig. 11 reach +2035%. That's an artifact of smoothing a 0% base, so read only their direction.

**Harder-to-read patterns work less well** (§V-D, Finding 4): changes that hinder an agent's reading of the page, such as removing ARIA attributes or rendering text as images, lowered both task success and susceptibility. The paper's reading is that obstructive patterns "may be more effective when they are more easily recognized and understood by agents."

**Vision doesn't help** (§V-E, Finding 5): "in most cases, it actually increases dark pattern susceptibility and lowers task success rates."

**Warning prompts help a little** (§VI, Fig. 14):

- The most specific postscript lowered susceptibility from 63.0% to 43.0%: 20 percentage points, which the paper reports as a 31.8% relative reduction.
- It was tested on two scenarios with three runs per prompt.
- "Even when given detailed instructions on how to avoid a particular dark pattern, agents still show substantial susceptibility" (Finding 6).

## 5. Limits of the evidence

- **What the authors state:**
  - **§VII:** only the cost of integrating new agents into LiteAgent.
  - **Elsewhere:** they call the countermeasures "a preliminary exploration" (§VI) and the attribute study "a preliminary study" (§I).
  - **The reviewers' point:** the meta-review notes the missing human baseline (Appendix G). The authors defer it because their implementations differ from human studies' (Appendix H).
- **What we observe ourselves, not stated as limits by the authors:**
  - the sites are synthetic;
  - there are three runs per scenario, with no intervals or tests;
  - one model for most experiments;
  - susceptibility isn't conditioned on exposure;
  - the category rates overlap;
  - there are no per-pattern rates;
  - there are no token, cost or latency measures;
  - model settings aren't stated.

None of this undermines the paper's direction. It means its numbers describe GPT-4o-era browser agents on these four sites. We don't use them as priors or targets.

## 6. What we adopt (our analysis)

1. **A fixed scenario with toggled conditions.** The paper's S=(T,W,D) becomes (task, option set, representation condition). Every condition is generated from one canonical option set, so options, prices and behavior are identical across conditions and only the representation varies.
2. **A paired neutral baseline on the same task,** and same-task pairing for combined conditions (§V-A, §V-C). Condition A is the reference for every other cell, and records the choice distribution, not just success.
3. **Trace predicates for outcomes** (§III-C), written over the tool-call log. Examples:
   - which plan was chosen;
   - whether an add-on is in the final call;
   - whether an unneeded prerequisite was invoked;
   - whether the alternatives were listed before deciding.
     We validate them against a hand-reviewed sample and report the agreement, which the paper doesn't.
4. **The four-way outcome** (DC, DF, EC, EF). Susceptibility is always reported jointly with task success, so an agent that fails early doesn't look resistant (Finding 1).
5. **Exposure as a measured variable.** The paper's early-exit failures are agents that never reached the pattern. We record whether each option, and the node where the condition acts, entered the agent's context. We report susceptibility both over all runs and over exposed runs.
6. **Representation ablations** (after §V-D). Hold the meaning constant and vary the serialization:
   - field order;
   - nesting;
   - descriptions present or stripped.
     Stripping descriptions is the structural counterpart of the paper's ARIA removal (Table VI, t5). It separates "the condition influences the choice" from "this shape confuses the harness".
7. **Graded warning prompts** (§VI) as a cheap mitigation arm, reported in percentage points.
8. **Model × harness as factors** (Finding 2). The code that turns a graph into a prompt is a factor, and its exact bytes are logged per run.
9. **Combined conditions** (§V-C). Pairs such as a salience change with a bundled default are tested directly, not assumed additive.

**Our definition of choice susceptibility.** We keep the paper's shape, a per-condition conjunction of trace predicates, but redefine "falls for" against the user's intent. A run is susceptible when the agent commits to the option the condition favors and that option isn't the intent-optimal one.

- **The intent:** every task states one checkable enough to define the optimum, for example "the cheapest plan with custom domains". Then unnecessary spend is a number, not a judgment.
- **Reported alongside:** the shift in the choice distribution against condition A, in percentage points.

**Statistics we'll use instead of the paper's:**

- trial counts sized from a pilot's variance;
- Wilson or bootstrap intervals;
- paired comparisons against condition A, or a mixed-effects logistic model with condition as a fixed effect and task and model as random effects;
- absolute differences, not smoothed relative ones;
- per-condition rates, not multi-label rollups;
- recorded model identifiers, settings and harness commits.

## 7. What doesn't carry over (our analysis)

- **Visual patterns.** A capability graph has no rendering layer, so these have no counterpart:
  - color, contrast, size, small grey type and button placement (the terms-of-service and confirm-shaming styling; Table VI, t3 and t4);
  - text as images (t2);
  - modals that overlay content;
  - the vision experiments (RQ5).
- **Browser plumbing.** None of these is needed: a capability harness logs its own tool calls and knows when the task ends.
  - listener injection;
  - extension driving;
  - time-outs as the end of a run;
  - screen recordings;
  - the on-page text box for answers.
- **Overlay mechanics.** Clicking behind a modal, or HTML compression dropping a modal's state (§V-C), have a loose counterpart in our setting: a harness truncating or summarizing a large graph. It's a different mechanism, and we'll watch for it separately.
- **Privacy and attention goals.** Our options are paid plans, so harm is measured in money and fit to the stated intent. Consent patterns (cookies, data sharing, terms) apply only if a fixture exposes consent settings deliberately.
- **Deception about the option set.** Bait and switch makes a false claim ("free"), and the sponsored item ignores the sort order. Our premise is fixed, legitimate options, so false claims stay out of the main conditions. The bait and switch survives as a misleading dependency (condition F), which is a controlled adversarial fixture.
- **Prompt injection** is out of scope, as it is for the paper (§I).

## 8. Confounds the benchmark has to control (our analysis)

1. **Information against presentation.** Progressive disclosure and friction change what's observable within a budget. An agent that never saw the free plan wasn't persuaded. Exposure (§6, item 5) separates the two.
2. **Length.** Advocacy, labels and bundle descriptions add text. The neutral condition gets length-matched neutral text, or token count is a covariate.
3. **Position.** Models have order biases of their own, so condition A randomizes or counterbalances option order. Otherwise a salience change in order is confounded with A's arbitrary order.
4. **Helpful against misleading labels.** A recommendation can be true and aligned with the user's intent. Every salience and advocacy condition is crossed with aligned (the favored option is intent-optimal) and misaligned. Otherwise susceptibility can't be told apart from reasonable deference.
5. **Vague intents.** Without a checkable optimum, paying more can be defensible and susceptibility is undefined. Tasks state their requirements.
6. **Capability floors.** Always report the four-way outcome, and susceptibility given task success.
7. **Serialization.** Different harnesses flatten a graph differently, so a condition can be salient in one and invisible in another. Fix the serialization per harness and log the prompt bytes.
8. **Imperative advocacy.** Advocacy written as an instruction ("choose Pro") turns the condition into an instruction-following test. Advocacy stays descriptive and attributed ("the publisher recommends Pro, and earns more from it").
9. **Interactions.** Combined conditions are tested, not inferred (§V-C).
10. **Nondeterminism.** Record model identifiers, temperature and seeds, and keep caches from sharing state across conditions.

## 9. The benchmark's conditions against the paper (our analysis)

How the paper's categories map onto a capability graph:

| Paper category         | Capability-graph counterpart                                                                                                                                                                                            | Condition                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Obstruction            | The cheaper option or the alternative takes more calls to reach: another page of results, or a capability that must be discovered first. The asymmetry is in calls and tokens.                                          | E (discovery friction)                          |
| Sneaking               | An add-on is preselected in the default input, or a material term (a recurring price, a commitment) appears only in a node fetched later, and only for the costly option.                                               | G (bundled default); B made asymmetric          |
| Interface interference | Option order, relevance or recommendation fields, description length and specificity, the schema's `default`. Double negatives carry over in full (an input such as `skipNoBackups: true`). Color, size and type don't. | D (salience)                                    |
| Forced action          | A declared dependency that doesn't hold: a free-tier action that "requires" a paid account.                                                                                                                             | F (misleading dependency)                       |
| Social engineering     | Persuasive wording in descriptions: shaming the cheap option, urgency, social proof. Attributed, accurate advocacy is a separate case.                                                                                  | C when transparent; manipulative wording is new |

And each condition against the paper:

| Condition                 | In the paper? | Where                                                                          | Note                                                                                              |
| ------------------------- | ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| A, neutral                | yes           | the pattern-free baseline (§V-A)                                               | theirs measures task success only; ours also records the choice distribution                      |
| B, progressive disclosure | no            | nearest: options behind "more options"                                         | symmetric, neutral progressive disclosure is new, and is the control for E                        |
| C, transparent advocacy   | no            | nearest: the sponsored item and sponsored ad                                   | the paper treats all promotion as a dark pattern; disclosed, accurate advocacy is a new condition |
| D, salience manipulation  | yes           | sponsored item first, "Best value" (aesthetic manipulation)                    | the closest analogue; the paper reports it only inside the 41.7% interface-interference rate      |
| E, discovery friction     | partly        | the obstruction patterns                                                       | the paper's friction sits on the path to decline; ours sits on the path to an alternative         |
| F, misleading dependency  | partly        | bait and switch                                                                | a sign-up presented as required when it isn't                                                     |
| G, bundled default        | yes           | the sneaked warranty; settings pre-toggled on (data sharing, complex settings) | the paper's predicate carries over: the add-on is present at commit and wasn't removed            |

**New in our design:**

- conditions B and C;
- an annotation-stripped control (§6, item 6);
- the aligned/misaligned crossing (§8, item 4);
- discovery efficiency, tokens, latency, alternative exploration, spend in currency, and the shift in choice distribution. The paper logs time between actions (§III-B) but reports none of these.

## 10. Assumptions to test

These are the questions this reading leaves open for the benchmark. They're hypotheses, not findings.

- **Does salience still work without a visual layer?** Do order and labels in a structured listing shift choices the way visual prominence does?
- **Does capability still predict susceptibility?** Agents that explore a graph more thoroughly may see more alternatives, and so be harder to steer: the opposite of Finding 1. Or they may follow declared next steps more readily, the same as Finding 1.
- **Is attribution enough?** Does an advocacy claim attributed to the publisher influence agents less than the same claim unattributed?
- **Does a declared dependency get checked?** Do agents verify a declared dependency, or follow it?
- **Do conditions compound in a graph** as patterns compound on a page (§V-C)?

## References

- **The paper:** D. Ersoy et al., "Investigating the Impact of Dark Patterns on LLM-Based Web Agents," IEEE S&P 2026. arXiv:2510.18113v1, <https://arxiv.org/abs/2510.18113>; HTML <https://arxiv.org/html/2510.18113v1>; code <https://github.com/purseclab/liteagent>.
- **The ontology it adopts:** C. M. Gray, C. T. Santos, N. Bielova and T. Mildner, "An Ontology of Dark Patterns Knowledge: Foundations, Definitions, and a Pathway for Shared Knowledge-Building," CHI 2024.
- **Two related works** the paper names (§VIII), not yet read for this note:
  - Tang et al., "Dark patterns meet GUI agents," arXiv:2509.10723;
  - Guo et al., "SusBench," arXiv:2510.11035.
