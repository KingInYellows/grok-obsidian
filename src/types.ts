export type AuthMode = "local-development" | "cloudflare-access";

export interface AppConfig {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly stagingRoot: string;
  readonly inboxDir: string;
  readonly auditDir: string;
  readonly authMode: AuthMode;
  readonly accessTeamDomain?: string;
  readonly accessAudience?: string;
  readonly allowedHosts: ReadonlySet<string>;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly maxRequestBytes: number;
  readonly maxResearchBytes: number;
  readonly maxNoteBytes: number;
  readonly requestsPerMinute: number;
  readonly enableListSubmissions: boolean;
}

export interface RequestIdentity {
  readonly ownerSubject: string;
}

export interface SubmissionInput {
  readonly title: string;
  readonly body_markdown: string;
  readonly source_urls?: readonly string[];
  readonly topic?: string;
  readonly idempotency_key: string;
}

export interface SubmissionReceipt {
  readonly note_id: string;
  readonly submitted_at: string;
  readonly status: "accepted";
  readonly content_sha256: string;
}

export interface SubmissionMetadata extends SubmissionReceipt {
  readonly title: string;
  readonly topic?: string;
}

export interface SubmissionRecord extends SubmissionMetadata {
  readonly owner_subject: string;
  readonly idempotency_key: string;
  readonly request_sha256: string;
  readonly filename: string;
  readonly temp_filename: string;
}

export interface SubmissionPage {
  readonly submissions: readonly SubmissionMetadata[];
  readonly next_cursor?: string;
}
