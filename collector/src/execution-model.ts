import type {Target} from './providers/types';
/** Pin execution to the quota decision, and detect worker/registration drift. */
export function executionModel(target:Target,job:{request:{model_class?:string};decision?:{selected?:{model?:string|null;quota_scope?:string|null}};continuation_session?:string|null}){
  const selected=job.decision?.selected;
  const expected=job.request.model_class?target.models[job.request.model_class]:target.default_model??(target.provider==='cursor'?'auto':null);
  const model=selected?.model??null;
  if(job.request.model_class&&!expected)throw new Error('model_not_configured');
  const continuing=!!job.continuation_session&&!job.request.model_class;
  if(continuing&&model!==expected&&!Object.values(target.models).includes(model??''))throw new Error('continuation_model_not_configured');
  if(!continuing&&model!==expected)throw new Error('model_registration_mismatch');
  if(target.provider==='cursor'&&(!model||selected?.quota_scope!==(model==='auto'?'cursor_auto':'cursor_api')))throw new Error('model_pool_binding_missing');
  return model;
}
