import {it,expect} from 'vitest';
import {executionModel} from '../src/execution-model';
import type {Target} from '../src/providers/types';
const target={provider:'cursor',models:{reasoning:'sonnet-4'}} as Target;
it('accepts an explicit Auto model tied to the Auto pool',()=>{
 const model=executionModel(target,{request:{},decision:{selected:{model:'auto',quota_scope:'cursor_auto'}}});
 expect(model).toBe('auto');
});
it('rejects missing pool binding, changed config, and unconfigured model requests',()=>{
 expect(()=>executionModel(target,{request:{}})).toThrow();
 expect(()=>executionModel(target,{request:{model_class:'reasoning'},decision:{selected:{model:'auto',quota_scope:'cursor_auto'}}})).toThrow('model_registration_mismatch');
 expect(()=>executionModel(target,{request:{model_class:'missing'}})).toThrow('model_not_configured');
 expect(()=>executionModel(target,{request:{},decision:{selected:{model:'auto',quota_scope:'cursor_api'}}})).toThrow('model_pool_binding_missing');
});
it('preserves a configured model for continuation instead of replacing it with auto',()=>{
 expect(executionModel(target,{request:{},continuation_session:'previous',decision:{selected:{model:'sonnet-4',quota_scope:'cursor_api'}}})).toBe('sonnet-4');
});
