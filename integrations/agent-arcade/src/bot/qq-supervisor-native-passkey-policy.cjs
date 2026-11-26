'use strict';
const P=require('./qq-supervisor-policy.cjs'),N=require('../qq-supervisor/native-passkeys-policy.cjs');
function envelope(v,e,keys){P.envelope(v,e,['nativePasskeyProtocol',...keys]);if(v.nativePasskeyProtocol!==N.PROTOCOL)P.fail('unsupported_version');return v;}
module.exports={...N,PREFIX:N.BASE,envelope};
