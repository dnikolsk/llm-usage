import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {seal,open,sessionKeyConfigured} from '../src/crypto';
import {beginEnrollment,readEnrollment,enrollmentMessage} from '../src/enroll';

describe('sealed provider sessions',()=>{
 beforeEach(()=>{process.env.LLM_SESSION_KEY='a'.repeat(64);});
 afterEach(()=>{delete process.env.LLM_SESSION_KEY;vi.restoreAllMocks();});
 it('round-trips only with the same key and purpose',()=>{
  const sealed=seal({access_token:'secret'},'provider-session:claude-personal');
  expect(sealed).not.toContain('secret');
  expect(open(sealed,'provider-session:claude-personal')).toEqual({access_token:'secret'});
  expect(()=>open(sealed,'provider-session:other')).toThrow('sealed_value_invalid');
  process.env.LLM_SESSION_KEY='b'.repeat(64);
  expect(()=>open(sealed,'provider-session:claude-personal')).toThrow('sealed_value_invalid');
  process.env.LLM_SESSION_KEY='short';expect(sessionKeyConfigured()).toBe(false);expect(()=>seal({},'x')).toThrow('session_key_required');
 });
 it('keeps PKCE state in a sealed, expiring cookie and never in the database',()=>{
  const begun=beginEnrollment('claude-personal','anthropic',1_000_000);
  expect(begun.cookie).not.toContain(begun.enrollment.pending.verifier);
  expect(readEnrollment(begun.cookie,1_000_001)).toMatchObject({account_id:'claude-personal',provider:'anthropic'});
  expect(readEnrollment(begun.cookie,1_000_000+11*60_000)).toBeNull();
  expect(readEnrollment('v1.garbage')).toBeNull();
  expect(()=>beginEnrollment('x','mistral')).toThrow('provider_unsupported');
  expect(enrollmentMessage('enrollment_pending')).toContain('not confirmed');
 });
});
