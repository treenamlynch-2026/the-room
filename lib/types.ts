export type AgentId = "chatgpt" | "claude";
export type Author = "human" | AgentId | "system";
export type RoutingMode = "single" | "parallel" | "review" | "handoff";
export type MessageStatus = "queued" | "streaming" | "complete" | "error" | "stopped";

export type Usage = { inputTokens: number; outputTokens: number };

export type Message = {
  id: string;
  projectId: string;
  author: Author;
  content: string;
  createdAt: string;
  replyToId?: string | null;
  /** requestedAgents = who replies. addressed = who was @mentioned (informational; never narrows requestedAgents). */
  routing?: { requestedAgents: AgentId[]; mode: RoutingMode; deep?: boolean; addressed?: AgentId[] } | null;
  status?: MessageStatus | null;
  model?: string | null;
  usage?: Usage | null;
  error?: string | null;
  approved?: boolean;
  approvedBy?: string | null;
};

export type CanonEntry = {
  id: string;
  projectId: string;
  title: string;
  body: string;
  priority: number; // 1 = highest
  source: string;
  pinned: boolean;
  active: boolean;
  createdAt: string;
};

export type Decision = {
  id: string;
  projectId: string;
  text: string;
  sourceMessageId?: string | null;
  createdAt: string;
};

export type FileKind = "text" | "image" | "pdf" | "video" | "other";

export type ProjectFile = {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  size: number;
  kind: FileKind;
  /** Pinned project-wide: sent on every call. */
  inContext: boolean;
  /** Set when the file was attached to a specific message. */
  messageId?: string | null;
  /** Processing result, e.g. "12 frames + transcript". */
  note?: string | null;
  createdAt: string;
};

export type Project = {
  id: string;
  name: string;
  description?: string | null;
  status: "active" | "paused" | "archived";
  defaultRouting: "both" | "last-agent";
  conversationSummary?: string | null;
  summaryThroughId?: string | null;
  models: Record<AgentId, string>;
  deepModels: Record<AgentId, string>;
  createdAt: string;
  updatedAt: string;
};

export type ProjectState = {
  project: Project;
  messages: Message[];
  canon: CanonEntry[];
  decisions: Decision[];
  files: ProjectFile[];
};

/** Provider-neutral content. Adapters translate these into each provider's format. */
export type Part =
  | { type: "text"; text: string; cache?: boolean }
  | { type: "image"; mime: string; data: string; cache?: boolean } // base64
  | { type: "pdf"; name: string; data: string; cache?: boolean }; // base64

export type Turn = { role: "user" | "assistant"; content: string | Part[] };

/** Normalized request handed to an adapter. Context is already assembled by the backend. */
export type AgentRequest = {
  model: string;
  system: string;
  /** Conversation turns from this agent's point of view. Other participants arrive as labeled user turns. */
  turns: Turn[];
  signal: AbortSignal;
};

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage?: Usage; model?: string }
  | { type: "error"; message: string; /** transient (network, 429, 5xx): the runner retries with backoff */ retryable?: boolean };

export interface AgentAdapter {
  id: AgentId;
  send(input: AgentRequest): AsyncIterable<AgentEvent>;
}

/** Server-sent events emitted to the browser while a turn streams. */
export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "delta"; id: string; text: string }
  | { type: "status"; id: string; status: MessageStatus; usage?: Usage | null; error?: string | null; model?: string | null }
  | { type: "end" };
