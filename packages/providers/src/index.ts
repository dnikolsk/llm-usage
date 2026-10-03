import {claude} from './claude';
import {codex} from './codex';
import {cursor} from './cursor';
import type {Observer,ProviderName} from './types';
export * from './types';
export {diagnosticCode,diagnostics} from './http';
export {claude,codex,cursor};
export const observers:Record<ProviderName,Observer>={anthropic:claude,openai:codex,cursor};
export const observerFor=(provider:string):Observer|null=>(observers as Record<string,Observer|undefined>)[provider]??null;
