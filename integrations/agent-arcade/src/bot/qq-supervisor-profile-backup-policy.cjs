'use strict';
const P=require('./qq-supervisor-policy.cjs'),B=require('../qq-supervisor/profile-backups-policy.cjs');
function envelope(v,e,keys){P.envelope(v,e,['profileBackupProtocol',...keys]);if(v.profileBackupProtocol!==B.PROTOCOL)P.fail('unsupported_version');return v;}
module.exports={...B,PREFIX:B.BASE,envelope};
