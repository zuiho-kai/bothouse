'use strict';

const {classifyGroupDrawing, typedDrawingRecipient} = require('./group-drawing-request.cjs');
const NATIVE_DRAWING_HINT = '要在 QQ 群里画图，请用 QQ 的 @ 菜单选中搭档，再发送绘图要求。这条没有发起绘图。';

const notices = Object.freeze({
  name_required:'请用一句话写清画面，再取一个简短的名字，一起发给我。',
  quota:'本群今天的绘图次数已用完。',
  credentials_missing:'当前搭档尚未连接绘图服务，这次没有画图。',
  name_conflict:'本群这位角色已有这个名字的图，请换一个名字。',
  not_found:'这次没有找到本群这位角色画的同名作品。',
  storage_full:'本群创作图存储已满，这次没有保存新图。',
  image_auth:'绘图服务拒绝了当前凭据。',
  image_forbidden:'当前绘图凭据没有使用此服务的权限。',
  image_rate_limited:'当前绘图服务正忙或限制了请求，请稍后再试。',
  image_quota_exceeded:'当前 Cloudflare Workers AI 额度已用完，请等额度恢复或由主人检查用量。',
  image_network:'这次没连上当前绘图服务，请检查网络后再试。',
  image_timeout:'等待绘图服务超时，这次未取得成图。',
  image_request_rejected:'绘图服务未接受这次创作要求。',
  image_model_unavailable:'当前绘图模型不可用，这次未取得成图。',
  image_invalid_response:'绘图服务没有返回可用的图片。',
  image_too_large:'这次的成图超出可处理的尺寸或大小。',
  image_provider_failed:'绘图服务本次未完成请求。',
  image_reference_rejected:'这次无法使用已批准的角色卡面。请在本群绘图设置检查并重新确认卡面。',
  image_content_rejected:'绘图服务未接受本次内容。',
  local_drawing_offline:'这次没连上主人的本机 ComfyUI。',
  local_drawing_busy:'主人的电脑正在忙，这次没能排进本机绘图。',
  local_drawing_gpu_unavailable:'这台电脑暂时没有足够的可用显卡资源启动本机绘图。',
  local_drawing_installation_invalid:'主人的本机 ComfyUI 安装需要重新配置，这次没画成。',
  local_drawing_wait_timeout:'本机绘图等候超时。这次没有提交给 ComfyUI。',
  local_drawing_model_missing:'本机 ComfyUI 暂时没有配置好的本轮工作流。',
  local_drawing_reference_failed:'这次没能用本群角色卡的卡面完成参考绘图。请检查卡面和本机编辑工作流。',
});
const groupDrawingNotice = code => Object.hasOwn(notices, code) ? notices[code] : null;
const changed = () => Object.assign(new Error('group drawing target changed'), {code:'changed'});
const receiptId = value => (typeof value === 'string' || Number.isSafeInteger(value)) && /^-?\d{1,20}$/.test(String(value));

class GroupDrawingRoute {
  constructor(route, handle, has) {
    this.route = route;
    this.handle = handle;
    this.has = has;
    this.pending = new Map();
  }

  receive(message, journalScope) {
    const route = this.route;
    if (message.groupPeerTurn || message.unsupported || message.quote ||
        message.voice || message.image || message.attachments || message.hasNativeFace || !message.contextToken) return null;
    if (message.commandAddress?.blocked === false && message.commandAddress.targets.length === 0) {
      const drawingHintName = typedDrawingRecipient(message.text);
      if (drawingHintName) {
        const action = route.groupCommandFor?.({...message,drawingHintName});
        return route.skipGroupCommand(message,journalScope,action,NATIVE_DRAWING_HINT);
      }
    }
    if (!message.nativeDrawingAddress) return null;
    const {groupId, from:senderId, contextToken} = message;
    const role = route.publicRoles.get(groupId);
    const characterId = route.characterFor(groupId);
    const other = message.nativeDrawingAddress === 'other';
    const request = classifyGroupDrawing(message.text, other ? 'self' : message.nativeDrawingAddress, role?.name || route.persona.name, characterId);
    if (!request) return null;
    // Drawing and retrieval both belong to the one person natively addressed.
    if (other) return route.skipUnselected(message, journalScope, 'group_drawing_other_recipient');
    if (request.action === 'chat' || request.action === 'inquiry') return request;
    if (typeof this.handle !== 'function') return null;
    const binding = {platform:route.platform, accountId:route.accountId, groupId, senderId, characterId};
    if (request.action === 'resend' && !request.source && !this.has?.(binding, request.name, {directed:request.directed})) return null;
    const prefix = 'group:' + groupId + ':';
    const eventId = typeof message.id === 'string' && message.id.startsWith(prefix) && message.id.slice(prefix.length);
    if (!receiptId(eventId)) return null;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, route.groupWorkSignal(groupId)]);
    const assertCurrent = () => {
      if (signal.aborted || !route.allowsOrdinaryGroupCommand(binding.accountId, groupId) ||
          route.publicRoles.get(groupId) !== role || route.isRecalled(message.id, senderId)) throw changed();
    };
    const reserveDelivery = () => { assertCurrent(); route.deliveryBudget(groupId); };
    const job = {senderId, controller};
    route.journal.disposition(journalScope, message.id, 'running');
    this.pending.set(message.id, job);
    job.promise = Promise.resolve().then(() => {
      assertCurrent();
      return this.handle({binding, request, eventId, signal, assertCurrent, reserveDelivery, contextToken});
    }).catch(error => error?.code === 'changed' ? {outcome:'not_sent',code:'changed'} : {outcome:'unknown'})
      .then(result => {
        const accepted = result?.outcome === 'accepted' && receiptId(result.messageId);
        const unknown = !accepted && result?.outcome !== 'not_sent';
        const cancelled = signal.aborted || ['changed','scope_changed','image_cancelled'].includes(result?.code);
        const state = accepted ? 'reply_ended' : unknown ? 'interrupted_unknown' : cancelled ? 'cancelled' : 'rejected';
        route.journal.disposition(journalScope, message.id, state);
        if (accepted) route.sent++;
        if (!cancelled && route.current()) {
          const problem = unknown ? '群创作图发送结果未确认，请在原群查看。' :
            result?.code === 'send_rejected' ? 'QQ 拒绝了这次群创作图发送。' :
            result?.code === 'storage_unavailable' ? '群创作图存储暂不可用。' : groupDrawingNotice(result?.code);
          if (problem) {
            route.problem = problem;
            this.lastProblem = {groupId, problem};
          } else if (accepted && this.lastProblem?.groupId === groupId && route.problem === this.lastProblem.problem) {
            route.problem = '';
            this.lastProblem = null;
          }
        }
      }).catch(() => { route.problem = '本次群创作图的本地回执未能保存，请在原群核对。'; })
      .finally(() => { this.pending.delete(message.id); route.changed(); });
    return {accepted:true, buffered:true};
  }

  recall(messageId, senderId) {
    const job = this.pending.get(messageId);
    if (job?.senderId === senderId) job.controller.abort();
  }

  cancel() { for (const job of this.pending.values()) job.controller.abort(); }
  idle() { return Promise.allSettled([...this.pending.values()].map(job => job.promise)); }
}

module.exports = {GroupDrawingRoute, groupDrawingNotice};
