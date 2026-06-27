// API client for the Legal Agent Mesh backend (FastAPI).
// Default targets local dev; override with VITE_API_BASE for deployed Cloud Run.

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8000";

export type BackendTraceStatus = "running" | "success" | "failed";

export interface BackendTrace {
  id: string;
  session_id: string;
  agent: string;
  tool: string;
  status: BackendTraceStatus;
  detail: string;
  mode: "live" | "demo";
  started_at: string;
  finished_at?: string | null;
  payload?: Record<string, unknown>;
}

export type Posture = "approve" | "amend" | "reject";

export interface BackendAgentResult {
  agent: string;
  model: string;
  summary: string;
  mode: "live" | "demo";
  findings: string[];
  stance: string;
  phase: "initial" | "resolution";
  assumptions: string[];
  red_flags: string[];
  reasoning: string;
}

export interface Classification {
  tier: number;
  tier_label: string;
  escalated: boolean;
  triggers: string[];
  recommended_posture: Posture;
  confidence: number;
}

export interface EvidenceItem {
  kind: "precedent" | "regulation" | "citation";
  title: string;
  source: string;
  detail: string;
  url: string;
}

export interface ChatResponse {
  session_id: string;
  answer: string;
  classification: Classification;
  agents: BackendAgentResult[];
  evidence: EvidenceItem[];
  traces: BackendTrace[];
  created_at: string;
}

export interface SignOffRecord {
  id: string;
  session_id: string;
  posture: Posture;
  rationale: string;
  tier: number;
  author: string;
  signed_at: string;
}

export async function signOff(input: {
  session_id: string;
  posture: Posture;
  rationale: string;
  tier: number;
  author?: string;
}): Promise<SignOffRecord> {
  const res = await fetch(`${API_BASE}/api/signoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`signoff ${res.status}`);
  return res.json();
}

export interface HealthResponse {
  status: string;
  integrations: Record<string, "live" | "demo">;
}

// ---- Multi-Matter Risk Ledger (Level 1) ----

export type MatterStatus = "review" | "warning" | "escalate" | "passed";
export type MatterAction = "review" | "signoff";

// The supervision lifecycle: plan → coordinate → review → sign off.
export type MatterStage = "plan" | "coordinate" | "review" | "signoff";

export interface MatterBlocker {
  count: number;
  tier: number;
  label: string;
}

export interface Matter {
  id: string;
  name: string;
  asset_class: string;
  deal_size: string;
  agents_deployed: string[];
  compliance_envelope: number;
  blockers: MatterBlocker;
  status: MatterStatus;
  stage: MatterStage;
  action: MatterAction;
}

export interface LedgerSummary {
  total_matters: number;
  total_blockers: number;
  avg_envelope: number;
  ready_to_sign: number;
}

export interface MattersResponse {
  matters: Matter[];
  summary: LedgerSummary;
}

export async function getMatters(): Promise<MattersResponse> {
  const res = await fetch(`${API_BASE}/api/matters`);
  if (!res.ok) throw new Error(`matters ${res.status}`);
  return res.json();
}

// ---- (i) Plan stage — create a supervised matter ----

export interface MatterCreate {
  name: string;
  asset_class?: string;
  deal_size?: string;
  jurisdiction?: string;
  agents_deployed?: string[];
  scope?: string[];
  redlines?: string[];
  envelope_target?: number;
  escalation_tier?: number;
}

export async function createMatter(input: MatterCreate): Promise<Matter> {
  const res = await fetch(`${API_BASE}/api/matters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`create matter ${res.status}`);
  return res.json();
}

// ---- (ii) Coordinate stage — the workstream board ----

export type TaskColumn =
  | "queued"
  | "risk"
  | "precedent"
  | "research"
  | "synthesis"
  | "counsel"
  | "signed";

export interface Task {
  id: string;
  ref: string;
  title: string;
  column: TaskColumn;
  agent: string;
  tier: number;
  flagged: boolean;
  note: string;
}

export interface TasksResponse {
  matter_id: string;
  matter_name: string;
  stage: MatterStage;
  columns: TaskColumn[];
  tasks: Task[];
  counts: Record<TaskColumn, number>;
}

export async function getTasks(matterId: string): Promise<TasksResponse> {
  const res = await fetch(`${API_BASE}/api/matters/${matterId}/tasks`);
  if (!res.ok) throw new Error(`tasks ${res.status}`);
  return res.json();
}

export function newSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json();
}

export async function sendChat(
  message: string,
  sessionId: string,
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}`);
  return res.json();
}

// Subscribe to live tool traces for a session via Server-Sent Events.
export function openTraceStream(
  sessionId: string,
  onTrace: (t: BackendTrace) => void,
): EventSource {
  const es = new EventSource(`${API_BASE}/api/trace/${sessionId}/stream`);
  es.onmessage = (ev) => {
    try {
      onTrace(JSON.parse(ev.data) as BackendTrace);
    } catch {
      /* ignore malformed frame */
    }
  };
  return es;
}

// ---- mapping helpers between backend payloads and the SignOff UI types ----

const TOOL_SERVICE: Record<string, string> = {
  nvidia_nim_infer: "NVIDIA NIM",
  query_neo4j_graph: "Neo4j Aura",
  gemini_reason: "Vertex AI",
  gemini_recommend: "Vertex AI",
  query_perplexity_research: "Perplexity",
  query_eu_cellar_api: "EU Cellar",
};

export function serviceForTool(tool: string): string {
  return TOOL_SERVICE[tool] ?? "Cloud Run";
}

export function durationMs(t: BackendTrace): number | undefined {
  if (!t.finished_at) return undefined;
  const start = Date.parse(t.started_at);
  const end = Date.parse(t.finished_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return Math.max(0, end - start);
}

export function rowsForTrace(t: BackendTrace): number | undefined {
  const p = t.payload ?? {};
  const arr =
    (p.rows as unknown[] | undefined) ??
    (p.matches as unknown[] | undefined);
  return Array.isArray(arr) ? arr.length : undefined;
}

export type UiAgent = "risk" | "precedent" | "deal";

export function uiAgentFor(name: string): UiAgent {
  const n = name.toLowerCase();
  if (n.includes("risk")) return "risk";
  if (n.includes("precedent")) return "precedent";
  return "deal";
}
