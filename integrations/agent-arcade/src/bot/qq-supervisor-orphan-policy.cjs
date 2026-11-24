'use strict';
// The desktop validates the same wire union but never calls the process manager.
const P=require('./qq-supervisor-policy.cjs'),Q=require('../qq-supervisor/orphan-policy.cjs');
const PROTOCOL=Q.PROTOCOL,PREFIX=Q.BASE,LIMITS=Q.LIMITS;
const valid=fn=>{try{return structuredClone(fn());}catch{P.fail('invalid_response');}};
function envelope(v,e,extra){P.envelope(v,e,['orphanProtocol',...extra]);if(v.orphanProtocol!==PROTOCOL)P.fail('unsupported_version');return v;}
function errorEnvelope(v,e){return valid(()=>{P.exact(v,['ok','instanceId','ledgerId','expectedQQ','protocol','componentVersion','orphanProtocol','code']);if(v.ok!==false||v.instanceId!==e.instanceId||v.expectedQQ!==e.expectedQQ||v.protocol!==P.PROTOCOL||v.componentVersion!==P.VERSION||v.orphanProtocol!==PROTOCOL||!P.CODES.has(v.code))P.fail('invalid_response');P.uuid(v.ledgerId);return v;});}
const capability=v=>valid(()=>Q.capability(v));
const inspection=(v,expectedQQ)=>valid(()=>{const r=Q.inspection(v);if(r.accountId!==expectedQQ)P.fail('instance_mismatch');return r;});
const preview=(v,expectedQQ)=>valid(()=>Q.preview(v,expectedQQ));
const operation=(v,expectedQQ)=>valid(()=>Q.operation(v,expectedQQ));
const confirmation=v=>{try{return Q.request(v);}catch{P.fail('invalid_request');}};
const previewRequest=v=>{try{return Q.previewRequest(v);}catch{P.fail('invalid_request');}};
const discardRequest=v=>{try{return Q.discardRequest(v);}catch{P.fail('invalid_request');}};
module.exports={PROTOCOL,PREFIX,LIMITS,envelope,errorEnvelope,capability,inspection,preview,operation,confirmation,previewRequest,discardRequest};
