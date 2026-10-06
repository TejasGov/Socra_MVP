import type {
  AiMode,
  AiRequestEnvelope,
  AssignmentContext,
  LatestExecutionContext,
  PolicyContext,
  ProviderMessage,
  RetrievedResource,
  WorkspaceContext,
} from "../types";

/** What a mode is allowed to put into model context. Enforced by `applyContextRules` before prompt assembly. */
export interface ContextRules {
  assignmentPrompt: boolean;
  studentWork: boolean;
  latestExecution: boolean;
  /** PUBLIC test outcomes only; hidden tests are never allowed in any student mode. */
  publicTestResults: boolean;
  hiddenTests: false;
  referenceSolution: boolean;
  retrievedResources: boolean;
  learnerProfile: boolean;
  analyticsPayload: boolean;
  authoringInput: boolean;
  /** Max prior conversation turns kept verbatim (older turns dropped; summary is future work). */
  maxConversationTurns: number;
}

export interface OutputHandling {
  /** structured: zod schema validated; text: plain text. */
  kind: "structured" | "text";
  schemaName: string | null;
  /** Run src/server/ai/policy-check.ts on the reply before the student sees it. */
  policyCheck: boolean;
  /** buffered: reply is released to the client only after validation/policy check; live: deltas stream directly. */
  delivery: "buffered" | "live";
  maxOutputTokens: number;
  /** Logging note stored with AiRequest.routingReason. */
  logging: string;
}

export interface ModeDefinition {
  mode: AiMode;
  promptTemplateId: string;
  promptVersion: string;
  policyVersion: string;
  contextRules: ContextRules;
  outputHandling: OutputHandling;
  buildSystemPrompt(ctx: AiRequestEnvelope): string;
}

/** Remove anything the mode's context rules disallow (defense in depth; callers should not include it anyway). */
export function applyContextRules(rules: ContextRules, env: AiRequestEnvelope): AiRequestEnvelope {
  const assignment: AssignmentContext | null = env.assignment
    ? {
        ...env.assignment,
        referenceSolution: rules.referenceSolution ? env.assignment.referenceSolution : undefined,
        prompt: rules.assignmentPrompt ? env.assignment.prompt : "",
      }
    : null;
  const latestExecution: LatestExecutionContext | null =
    rules.latestExecution && env.latestExecution
      ? {
          ...env.latestExecution,
          publicTests: rules.publicTestResults ? env.latestExecution.publicTests : undefined,
        }
      : null;
  return {
    ...env,
    assignment,
    workspace: rules.studentWork ? env.workspace : null,
    latestExecution,
    retrievedResources: rules.retrievedResources ? env.retrievedResources : [],
    learnerContext: rules.learnerProfile ? (env.learnerContext ?? null) : null,
    analyticsPayload: rules.analyticsPayload ? (env.analyticsPayload ?? null) : null,
    authoringInput: rules.authoringInput ? (env.authoringInput ?? null) : null,
    conversation: env.conversation.slice(-rules.maxConversationTurns),
  };
}

export function renderAssignment(a: AssignmentContext | null): string {
  if (!a) return "No assignment context.";
  const lines = [
    `Assignment: ${a.title} (format ${a.format}, version ${a.assignmentVersion})`,
    a.prompt ? `Prompt:\n${a.prompt}` : "",
    a.learningObjectives.length ? `Learning objectives:\n- ${a.learningObjectives.join("\n- ")}` : "",
    a.topicTags.length ? `Topics: ${a.topicTags.join(", ")}` : "",
    a.starterCode ? `Starter code:\n${a.starterCode}` : "",
    a.referenceSolution ? `Reference solution (released for review):\n${a.referenceSolution}` : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

export function renderPolicy(p: PolicyContext | null): string {
  if (!p) return "";
  const ladder = p.hintLadder.map((h) => `  L${h.level}: ${h.guidance}`).join("\n");
  return [
    `Course Socra policy version ${p.policyVersion}; maximum intervention level L${p.maxInterventionLevel}.`,
    `Direct syntax help allowed: ${p.allowDirectSyntaxHelp ? "yes" : "no"}.`,
    ladder ? `Instructor hint ladder:\n${ladder}` : "",
    p.allowedBehaviors.length ? `Instructor-allowed: ${p.allowedBehaviors.join("; ")}` : "",
    p.forbiddenBehaviors.length ? `Instructor-forbidden: ${p.forbiddenBehaviors.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function withLineNumbers(code: string): string {
  return code
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(3, " ")} | ${l}`)
    .join("\n");
}

export function renderWorkspace(w: WorkspaceContext | null): string {
  if (!w) return "No student work available.";
  if (!w.code.trim()) return `Student work (${w.language ?? "text"}): (empty)`;
  return `Student work (${w.language ?? "text"}${w.questionTitle ? `, ${w.questionTitle}` : ""}), with line numbers:\n${withLineNumbers(w.code)}`;
}

export function renderExecution(r: LatestExecutionContext | null): string {
  if (!r) return "The student has not run the code yet.";
  const parts = [`Latest run status: ${r.status}${r.exitCode !== null ? ` (exit ${r.exitCode})` : ""}`];
  if (r.stdout.trim()) parts.push(`stdout:\n${r.stdout.slice(0, 2000)}`);
  if (r.stderr.trim()) parts.push(`stderr:\n${r.stderr.slice(0, 2000)}`);
  if (r.publicTests?.length) {
    parts.push(
      `Public tests:\n${r.publicTests.map((t) => `- ${t.name}: ${t.passed ? "passed" : "FAILED"}${t.message ? ` (${t.message})` : ""}`).join("\n")}`,
    );
  }
  if (r.diagnosticSignals?.length) parts.push(`Diagnostic signals: ${r.diagnosticSignals.join(", ")}`);
  return parts.join("\n");
}

export function renderResources(rs: RetrievedResource[]): string {
  if (!rs.length) return "No course resources retrieved.";
  return `Approved course resources (cite by id when you use one):\n${rs
    .map((r) => `[${r.resourceId}] ${r.title}\n${r.excerpt.slice(0, 800)}`)
    .join("\n\n")}`;
}

/**
 * Message order: stable prefix first (system, then assignment/policy/resources) for prompt caching; then prior
 * conversation; then the changing workspace + latest message last.
 */
export function assembleMessages(def: ModeDefinition, env: AiRequestEnvelope): ProviderMessage[] {
  const stable: string[] = [];
  if (env.assignment) stable.push(renderAssignment(env.assignment));
  const policy = renderPolicy(env.policy);
  if (policy) stable.push(policy);
  if (def.contextRules.retrievedResources) stable.push(renderResources(env.retrievedResources));
  if (env.learnerContext?.topicStates.length) {
    stable.push(
      `Learner topic states (practice personalization only):\n${env.learnerContext.topicStates.map((t) => `- ${t.topic}: ${t.state}`).join("\n")}`,
    );
  }
  if (env.analyticsPayload) stable.push(`Computed metrics (JSON):\n${JSON.stringify(env.analyticsPayload, null, 2)}`);
  if (env.authoringInput) stable.push(`Authoring request (JSON):\n${JSON.stringify(env.authoringInput, null, 2)}`);

  const messages: ProviderMessage[] = [{ role: "system", content: def.buildSystemPrompt(env) }];
  if (stable.length) messages.push({ role: "developer", content: stable.join("\n\n---\n\n") });
  for (const t of env.conversation) messages.push({ role: t.role, content: t.content });

  const live: string[] = [];
  if (def.contextRules.studentWork) live.push(renderWorkspace(env.workspace));
  if (def.contextRules.latestExecution) live.push(renderExecution(env.latestExecution));
  live.push(`Message:\n${env.userMessage}`);
  messages.push({ role: "user", content: live.join("\n\n") });
  return messages;
}
