'use strict';
(() => {
const PROTOCOL='fixed-shell-code-recovery/1',BASE='/v1/component-repair',MAX_RESPONSE_BYTES=65536;
const VERSION='4.18.42',VERSION_ID='napcat-shell-4.18.42-02e5ff0f79916c1e';
const ACTIONS=Object.freeze(['repair','abandon-prepared','complete-prepared','restore-original','acknowledge-complete']);
const EXTRA_CODES=Object.freeze(['component_repair_disabled','invalid_response','preview_required','preview_expired','stale_ticket','unsafe_path','manifest_invalid','artifact_changed','artifact_conflict','archive_invalid','archive_unsafe','archive_limit','package_not_staged','digest_mismatch','size_mismatch','component_locked','shell_repair_unavailable','shell_repair_not_needed','shell_repair_scope_unverified','shell_repair_source_unavailable','shell_repair_changed','shell_repair_busy','shell_repair_history_full','shell_repair_failed','shell_repair_readback_failed','shell_repair_unconfirmed','shell_repair_recovery_required','shell_repair_cleanup_unconfirmed','cancelled','response_too_large']);
const browserPolicy={
  keys(value, fields) { if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key)))throw Error('invalid_response'); },
  uuid:value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value),
  safeCode:error=>typeof error?.code==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(error.code)?error.code:'runtime_failed',
};
const P=()=>browserPolicy,hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),epoch=v=>Number.isSafeInteger(v)&&v>=0,bool=v=>typeof v==='boolean',nullableBool=v=>v===null||bool(v);
const safeCode=e=>EXTRA_CODES.includes(e?.code)?e.code:P().safeCode(e);
const fail=(code,status=409)=>{const safe=safeCode({code});throw Object.assign(Error(safe),{code:safe,status});};
function check(v,fields){try{P().keys(v,fields);}catch{fail('invalid_response');}}
function fixed(v){if(v.component!=='napcat-shell'||v.version!==VERSION||v.versionId!==VERSION_ID)fail('invalid_response');}
function previewRequest(v){P().keys(v,['action','observationId','operationId']);if(!ACTIONS.includes(v.action)||(v.action==='repair'?(!P().uuid(v.observationId)||v.operationId!==null):(v.observationId!==null||!P().uuid(v.operationId))))fail('invalid_request',400);return structuredClone(v);}
function request(v){P().keys(v,['requestId','action','operationId','ticketId','expectedDigest']);if(!P().uuid(v.requestId)||!ACTIONS.includes(v.action)||!P().uuid(v.operationId)||!P().uuid(v.ticketId)||!hex(v.expectedDigest))fail('invalid_request',400);return structuredClone(v);}
function capability(v){check(v,['supported','enabled','component','version','versionId','scope','source','requiresStoppedRuntime','automaticStart','automaticStop','versionChange','maxResponseBytes']);fixed(v);if(v.supported!==true||!bool(v.enabled)||v.scope!=='shared-fixed-shell-code'||v.source!=='verified-local-cache-only'||v.requiresStoppedRuntime!==true||['automaticStart','automaticStop','versionChange'].some(k=>v[k]!==false)||v.maxResponseBytes!==MAX_RESPONSE_BYTES)fail('invalid_response');return structuredClone(v);}
function scope(v){check(v,['installations','enumeration','allWithinStoreVerified','outsideStoreMetadataEnumerated']);if(!Array.isArray(v.installations)||!v.installations.length||v.installations.length>32||v.enumeration!=='component-store'||v.allWithinStoreVerified!==true||v.outsideStoreMetadataEnumerated!==false)fail('invalid_response');const ids=new Set(),setups=new Set();for(const row of v.installations){check(row,['setupId','installationId']);if(!P().uuid(row.setupId)||!hex(row.installationId)||ids.has(row.installationId)||setups.has(row.setupId))fail('invalid_response');ids.add(row.installationId);setups.add(row.setupId);}return structuredClone(v);}
function source(v){check(v,['verification','archiveBytes','fileCount','totalBytes']);if(v.verification!=='full-pinned-archive-and-manifest'||v.archiveBytes!==35967555||!Number.isInteger(v.fileCount)||v.fileCount<1||v.fileCount>10000||!epoch(v.totalBytes)||v.totalBytes>512*1024*1024)fail('invalid_response');return structuredClone(v);}
function inspection(v){check(v,['observationId','component','version','versionId','state','source','stopped','reason','scope','canPrepare','metadata','history','pending','retention']);fixed(v);scope(v.scope);check(v.source,['state','archiveBytes']);check(v.metadata,['descriptorVerified','manifestVerified']);check(v.retention,['records','bytes','maxRecords','maxBytes']);if(!P().uuid(v.observationId)||!['healthy','damaged','missing','recovery_required'].includes(v.state)||!['verified-cache','not-staged','unverified'].includes(v.source.state)||v.source.archiveBytes!==35967555||!['verified','running','unverified'].includes(v.stopped)||v.reason!==null&&safeCode({code:v.reason})!==v.reason||!bool(v.canPrepare)||v.canPrepare&&(!['damaged','missing'].includes(v.state)||v.source.state!=='verified-cache'||v.stopped!=='verified')||v.metadata.descriptorVerified!==true||v.metadata.manifestVerified!==true||!Array.isArray(v.history)||!Array.isArray(v.pending)||v.history.length+v.pending.length>16||!epoch(v.retention.records)||v.retention.records!==v.history.length+v.pending.length||!epoch(v.retention.bytes)||v.retention.bytes>8589934592||v.retention.maxRecords!==16||v.retention.maxBytes!==8589934592)fail('invalid_response');const ids=new Set();for(const row of v.history){check(row,['operationId','state','endedAt','retainedBytes']);if(!P().uuid(row.operationId)||ids.has(row.operationId)||!['completed','restored','abandoned'].includes(row.state)||!epoch(row.endedAt)||!epoch(row.retainedBytes)||row.retainedBytes>8589934592)fail('invalid_response');ids.add(row.operationId);}for(const row of v.pending){check(row,['operationId','state','decisions']);if(!P().uuid(row.operationId)||ids.has(row.operationId)||!['interrupted','prepared_only','blocked'].includes(row.state)||!Array.isArray(row.decisions)||new Set(row.decisions).size!==row.decisions.length||row.decisions.some(x=>!ACTIONS.slice(1).includes(x))||row.state==='blocked'&&row.decisions.length)fail('invalid_response');ids.add(row.operationId);}if(v.canPrepare&&v.pending.length)fail('invalid_response');return structuredClone(v);}
const EFFECT_KEYS=['replacesCode','retainsOriginalTreeIfPresent','restoresOriginalCode','settlesExistingPublication','removesRetainedCode','changesDescriptors','changesPreparedManifest','writesAccountData','changesWorkPaths','versionChange','automaticStop','automaticStart'];
function preview(v){check(v,['action','operationId','ticketId','expectedDigest','expiresAt','component','version','versionId','scope','source','previousTree','effects']);fixed(v);scope(v.scope);check(v.effects,EFFECT_KEYS);if(!ACTIONS.includes(v.action)||!P().uuid(v.operationId)||!P().uuid(v.ticketId)||!hex(v.expectedDigest)||!epoch(v.expiresAt)||EFFECT_KEYS.some(k=>!bool(v.effects[k]))||EFFECT_KEYS.slice(4).some(k=>v.effects[k]!==false))fail('invalid_response');if(v.effects.replacesCode!==['repair','complete-prepared'].includes(v.action)||v.effects.retainsOriginalTreeIfPresent!==(v.action==='repair')||v.effects.restoresOriginalCode!==(v.action==='restore-original')||v.effects.settlesExistingPublication!==(v.action==='acknowledge-complete'))fail('invalid_response');if(v.action==='repair'){source(v.source);if(!['present','absent'].includes(v.previousTree))fail('invalid_response');}else if(v.source!==null||v.previousTree!==null)fail('invalid_response');return structuredClone(v);}
function result(v){check(v,['receiptId','action','operationId','operation','committed','liveCode','oldTreeRetained','readback','recoveryRequired','cleanupVerified','descriptorBytesUnchanged','manifestBytesUnchanged','selectionBytesUnchanged','dataPathsUnchanged','accountDataVerification','automaticStart','automaticStop','versionChange','code']);if(!P().uuid(v.receiptId)||!P().uuid(v.operationId)||!ACTIONS.includes(v.action)||v.operation!==(v.action==='repair'?'shell-code-repair':'shell-code-reconcile')||!nullableBool(v.committed)||!nullableBool(v.oldTreeRetained)||!['unchanged','same-version-verified','original-restored','unverified'].includes(v.liveCode)||!['unavailable','full-manifest','original-proof'].includes(v.readback)||!bool(v.recoveryRequired)||!bool(v.cleanupVerified)||['descriptorBytesUnchanged','manifestBytesUnchanged','selectionBytesUnchanged','dataPathsUnchanged'].some(k=>!nullableBool(v[k]))||v.accountDataVerification!=='not-read'||['automaticStart','automaticStop','versionChange'].some(k=>v[k]!==false)||v.code!==null&&safeCode({code:v.code})!==v.code)fail('invalid_response');if(v.readback==='full-manifest'&&(v.committed!==true||v.liveCode!=='same-version-verified')||v.readback==='original-proof'&&(v.committed!==true||!['original-restored','unchanged'].includes(v.liveCode))||v.readback!=='unavailable'&&['descriptorBytesUnchanged','manifestBytesUnchanged','selectionBytesUnchanged','dataPathsUnchanged'].some(k=>v[k]!==true)||v.committed===null&&(!v.recoveryRequired||v.readback!=='unavailable')||!v.cleanupVerified&&!v.code)fail('invalid_response');return structuredClone(v);}
function operation(v){check(v,['type','requestId','action','operationId','phase','startedAt','finishedAt','code','result']);if(v.type!=='component-repair'||!P().uuid(v.requestId)||!ACTIONS.includes(v.action)||!P().uuid(v.operationId)||!['attempted','completed','not_submitted','unknown'].includes(v.phase)||!epoch(v.startedAt)||v.code!==null&&safeCode({code:v.code})!==v.code)fail('ledger_locked');if(v.phase==='attempted'?(v.finishedAt!==null||v.code!==null||v.result!==null):(!epoch(v.finishedAt)||v.finishedAt<v.startedAt))fail('ledger_locked');if(v.result!==null){result(v.result);if(v.result.receiptId!==v.requestId||v.result.operationId!==v.operationId||v.result.action!==v.action||v.result.code!==v.code)fail('ledger_locked');}if(v.phase==='completed'&&(!v.result||typeof v.result.committed!=='boolean')||v.phase==='unknown'&&v.result!==null&&v.result.committed!==null||v.phase==='not_submitted'&&v.result!==null)fail('ledger_locked');return structuredClone(v);}

  // This view consumes only the bounded component-repair metadata protocol.
  const valid = (fn, value) => { try { fn(value); return true; } catch { return false; } };
  function previewOK(value) {
    if (!value || value.kind !== 'component-repair' || !P().uuid(value.supervisorId)) return false;
    const { kind, supervisorId, ...wire } = value;
    return valid(preview, { ...wire, expectedDigest: '0'.repeat(64) });
  }
  function matchesOperation(value, expected) {
    return valid(operation, value) && value.requestId === expected.requestId &&
      value.action === expected.action && value.operationId === expected.operationId;
  }
  function changeOK(value, expected) {
    try {
      check(value, ['requestId', 'action', 'operationId', 'outcome', 'operation', 'pending', 'code']);
      return P().uuid(value.requestId) && value.action === expected.action &&
        value.operationId === expected.operationId && ['accepted', 'rejected', 'unknown', 'not_submitted'].includes(value.outcome) &&
        bool(value.pending) && (value.code === null || safeCode({ code: value.code }) === value.code) &&
        (value.operation === null || matchesOperation(value.operation, value)) &&
        (value.outcome !== 'accepted' || value.operation?.phase === 'completed') &&
        (value.outcome !== 'rejected' || value.operation?.phase === 'not_submitted');
    } catch { return false; }
  }
  function queryOK(value, expected) {
    try {
      check(value, ['requestId', 'action', 'operationId', 'found', 'operation', 'pending', 'canEndRecovery', 'code']);
      return value.requestId === expected.requestId && value.action === expected.action &&
        value.operationId === expected.operationId && ['found', 'pending', 'canEndRecovery'].every(k => bool(value[k])) &&
        (value.code === null || safeCode({ code: value.code }) === value.code) &&
        (value.found ? matchesOperation(value.operation, value) : value.operation === null) &&
        (!value.canEndRecovery || value.operation?.phase === 'unknown' && value.operation.finishedAt !== null);
    } catch { return false; }
  }
  function render(view, actions, language) {
    const tr = (zh, en) => language === 'en' ? en : zh;
    const el = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const button = (id, label, fn, disabled = false, primary = false) => {
      const element = el('button', primary ? 'primary' : 'secondary', label);
      element.type = 'button'; element.id = 'qsv-repair-' + id;
      element.disabled = !!view.busy || disabled;
      element.onclick = () => { if (!element.disabled) fn(); };
      return element;
    };
    const labels = {
      repair: tr('修复组件代码', 'Repair component code'),
      'abandon-prepared': tr('保留文件并结束这次准备', 'Retain files and end preparation'),
      'complete-prepared': tr('完成这次代码替换', 'Complete this replacement'),
      'restore-original': tr('还原保留的原代码', 'Restore the retained original'),
      'acknowledge-complete': tr('核实并结束已完成的替换', 'Verify and settle the replacement'),
    };
    const root = el('section', 'qsv-repair');
    root.append(el('h3', '', tr('修复远端组件', 'Repair remote component')),
      el('p', 'qsv-target', 'NapCat Shell 4.18.42'),
      el('p', 'qrmt-note', tr('从远端已校验的本机缓存修复同一版本，保留原代码。不会自动停止或启动 QQ。',
        'Restore the same version from the remote host’s verified local cache and retain the original code. QQ is not stopped or started automatically.')));

    if (view.preview) {
      const p = view.preview, box = el('section', 'qrmt-review');
      box.id = 'qsv-repair-preview';
      box.append(el('h4', '', labels[p.action]),
        el('p', '', tr(`此代码由同一组件目录中的 ${p.scope.installations.length} 个安装共用。`,
          `This code is shared by ${p.scope.installations.length} installations in the component store.`)));
      if (p.action === 'repair') {
        box.append(el('p', '', tr(`已完整校验缓存与 ${p.source.fileCount} 个代码文件；${p.previousTree === 'present' ? '现有代码会另行保留。' : '原代码目录缺失。'}`,
          `The cache and ${p.source.fileCount} code files were fully verified; ${p.previousTree === 'present' ? 'the existing code will be retained separately.' : 'the original code directory is missing.'}`)));
      } else if (p.action === 'restore-original') {
        box.append(el('p', 'qrmt-warning', tr('还原保留的原件不代表它原本没有损坏；还原后仍需检查。',
          'Restoring the original does not establish that it was healthy. Inspect it after restoration.')));
      }
      box.append(el('p', 'qrmt-note', tr('安装记录、版本选择和账号数据路径保持原样。账号数据内容不会读取或重新导入。',
        'Installation records, version selections and account-data paths stay in place. Account-data contents are not read or reimported.')));
      const row = el('div', 'qrmt-actions');
      row.append(button('confirm', labels[p.action], actions.confirm, false, true),
        button('discard', tr('结束预览并返回', 'End preview and go back'), actions.discard));
      box.append(row); root.append(box); return root;
    }

    const row = el('div', 'qrmt-actions');
    row.append(button('read', view.read ? tr('重新检查', 'Inspect again') : tr('检查组件', 'Inspect component'), actions.read));
    if (view.pending) row.append(button('query', tr('查询原操作', 'Query original operation'), actions.query, false, true));
    else if (view.inspection?.canPrepare) row.append(button('prepare', tr('准备修复…', 'Prepare repair…'), () => actions.preview('repair', null), false, true));
    root.append(row);
    if (view.pending) root.append(el('p', 'qrmt-note', tr('原请求尚待核实。检查不会重新提交修复，也不会清除未知结果。',
      'The original request is unresolved. Inspection does not repeat the repair or clear an unknown outcome.')));
    if (view.read) {
      if (!view.capability) root.append(el('p', 'qrmt-note', tr('此监督器版本尚未提供组件修复。', 'This supervisor does not provide component repair.')));
      else if (!view.capability.enabled) root.append(el('p', 'qrmt-note', tr('远端管理员尚未开启组件修复。启停权限不会自动开启它。',
        'The remote administrator has not enabled component repair. Start and Stop permissions do not enable it.')));
      else if (view.inspection) {
        const i = view.inspection, status = {
          healthy: tr('代码校验通过，无需修复', 'Code verified; no repair needed'),
          damaged: tr('代码需要修复', 'Code needs repair'),
          missing: tr('代码目录缺失', 'Code directory missing'),
          recovery_required: tr('上次修复尚未收尾', 'Previous repair needs attention'),
        }[i.state];
        root.append(el('h4', '', status),
          el('p', 'qrmt-note', tr(`${i.scope.installations.length} 个共享安装 · ${i.stopped === 'verified' ? '已核实停止' : i.stopped === 'running' ? '仍有相关进程运行' : '尚未核实进程状态'}`,
            `${i.scope.installations.length} shared installations · ${i.stopped === 'verified' ? 'stopped state verified' : i.stopped === 'running' ? 'related processes running' : 'process state unverified'}`)),
          el('p', 'qrmt-note', i.source.state === 'verified-cache' ? tr('同版本官方缓存已校验。', 'The official same-version cache is verified.') :
            tr('缺少可用的已校验缓存，请先在远端准备固定版本组件。这里不会自动下载。', 'No verified cache is available. Prepare the fixed component on the remote host first; this view does not download it.')));
        if (i.stopped !== 'verified') root.append(el('p', 'qrmt-note', tr('请先明确停止共享此代码的 QQ，再检查。', 'Explicitly stop QQ instances sharing this code, then inspect again.')));
        for (const [index, pending] of i.pending.entries()) {
          const box = el('section', 'qrmt-review');
          box.append(el('h4', '', tr(`待处理记录 ${index + 1}`, `Unsettled record ${index + 1}`)));
          if (!pending.decisions.length) box.append(el('p', 'qrmt-warning', tr('文件身份或状态尚未核实，不能继续替换。保留原件并由远端管理员检查。',
            'File identity or state is unverified, so replacement cannot continue. Retain the files and ask the remote administrator to inspect them.')));
          else for (const decision of pending.decisions) box.append(button('decision-' + index + '-' + decision,
            labels[decision] + '…', () => actions.preview(decision, pending.operationId), !!view.pending));
          root.append(box);
        }
        if (i.history.length) {
          const history = el('details', 'qsv-details');
          history.append(el('summary', '', tr(`已保留 ${i.history.length} 条记录`, `${i.history.length} retained records`)),
            el('p', 'qrmt-note', tr('原代码和操作记录仍保留在远端，不会自动删除。', 'Original code and operation records remain on the remote host; they are not deleted automatically.')));
          root.append(history);
        }
      }
    }
    if (view.result) {
      const value = view.result, op = value.operation, result = op?.result, box = el('section', 'qrmt-review');
      box.id = 'qsv-repair-result'; box.setAttribute('role', 'status');
      let title = tr('结果尚未确认', 'Outcome unconfirmed');
      let detail = tr('远端可能已经处理，请查询原操作，不重复提交。', 'The remote host may have handled the request. Query the original operation; do not resubmit.');
      if (result?.committed === true && result.readback === 'full-manifest') {
        title = tr('同版本代码已修复并核验', 'Same-version code repaired and verified');
        detail = tr('完整代码与清单一致；QQ 尚未启动，也未验证账号登录。', 'The complete code matches the manifest. QQ was not started and account login was not verified.');
      } else if (result?.committed === true && result.liveCode === 'original-restored') {
        title = tr('保留的原代码已还原', 'Retained original code restored');
        detail = tr('原件身份和内容已核实，但不代表原件健康。请重新检查组件。', 'The original identity and contents were verified, but this does not prove the original was healthy. Inspect the component again.');
      } else if (result?.committed === true && op.action === 'abandon-prepared') {
        title = tr('本次准备已结束', 'Preparation ended');
        detail = tr('预备文件和原代码保留；没有替换或启动 QQ。', 'Prepared files and original code remain; QQ was not replaced or started.');
      } else if (result?.committed === false || op?.phase === 'not_submitted' || value.outcome === 'not_submitted' || value.found === false && !value.pending) {
        title = tr('此次操作未完成代码变更', 'This operation did not complete a code change');
        detail = tr('核对原因后重新检查；不要把此结果当作修复成功。', 'Check the reason and inspect again. This is not a successful repair.');
      }
      box.append(el('h4', '', title), el('p', '', detail));
      if (value.code === 'cleanup_unconfirmed') box.append(el('p', 'qrmt-warning', tr('文件结果已保留，本机连接收尾尚未确认。请关闭此页，重新打开后查询原操作。',
        'The file result is retained, but local connection cleanup is unconfirmed. Close this view, reopen it and query the original operation.')));
      if (result?.recoveryRequired || result?.cleanupVerified === false) box.append(el('p', 'qrmt-warning', tr('仍有记录或资源需要收尾。已有文件结果会保留；重新检查前不要直接启动 QQ。',
        'Records or resources still need attention. The observed file outcome is retained; inspect before starting QQ.')));
      root.append(box);
    }
    return root;
  }
  window.QQSupervisorComponentRepair = {
    capabilityOK: value => valid(capability, value), inspectionOK: value => valid(inspection, value),
    previewOK, changeOK, queryOK, operationOK: matchesOperation, render,
  };

})();
