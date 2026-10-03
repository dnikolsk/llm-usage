import {z} from 'zod';
import type {IngestSnapshot} from '@llm-usage/core';

export const providerName=z.enum(['anthropic','openai','cursor','google']);
export type ProviderName=z.infer<typeof providerName>;

/** One provider login held by the service. Refresh material never leaves the service. */
export const grant=z.object({
  access_token:z.string().min(1),
  refresh_token:z.string().min(1).nullable().default(null),
  /** Epoch milliseconds; null when the provider did not state a lifetime. */
  expires_at:z.number().int().positive().nullable().default(null),
  /** Provider-specific, non-secret identifiers needed by the CLI or telemetry calls (e.g. a ChatGPT account id). */
  claims:z.record(z.string(),z.string()).default({}),
  /** Secondary tokens the CLI expects alongside the access token (e.g. an OpenID id_token). */
  extra_tokens:z.record(z.string(),z.string()).default({}),
}).strict();
export type Grant=z.infer<typeof grant>;

/** Server-side PKCE state for an enrollment in progress; sealed in a cookie, never stored in the database. */
export const pendingEnrollment=z.object({verifier:z.string().min(43).max(128),state:z.string().min(16).max(128),redirect_uri:z.string().optional(),nonce:z.string().optional()}).strict();
export type PendingEnrollment=z.infer<typeof pendingEnrollment>;

export type Begin={authorization_url:string;pending:PendingEnrollment;instructions:string;input_label:string|null};
export type Reading={allowed:boolean|null;snapshot:IngestSnapshot};
/** A CLI credential file as the worker must write it: relative to the account's auth directory, mode 0600. */
export type CredentialFile={path:string;content:string};
export type Platform='linux'|'darwin';

export interface Observer{
  provider:ProviderName;
  /** Human name shown in the dashboard. */
  label:string;
  begin(deps?:Deps):Begin;
  /** `input` is whatever the person pastes back (a code, a redirected URL, or nothing for poll-style flows). */
  complete(pending:PendingEnrollment,input:string,deps?:Deps):Promise<Grant>;
  refresh(current:Grant,deps?:Deps):Promise<Grant>;
  readUsage(current:Grant,accountId:string,deps?:Deps):Promise<Reading>;
  /** Credential file(s) for the official CLI, deliberately without refresh material. */
  credentialFiles(current:Grant,platform:Platform):CredentialFile[];
}
export type Deps={fetch?:typeof fetch;now?:()=>number;random?:(bytes:number)=>Buffer};
