'use strict';

const {decision, inWindow} = require('./social-companion.cjs');
const {clean} = require('./dispatcher.cjs');
const {GROUP_IDLE_QUIET_MS} = require('./group-rhythm.cjs');
const {followupModelTime} = require('./followup-time.cjs');
const {GROUP_SPEECH_INSTRUCTION} = require('./group-spoken-dialogue.cjs');
const {selectGroupDialogue} = require('./group-dialogue-selection.cjs');

const wait = reason => ({action: 'wait', reason});
const pending = actor => actor.store.followups(actor.scope, {state: 'pending', limit: 30});
const memberEnabled = actor => actor.store.config().proactiveMessages && !actor.engine.activityFailed;
const replyBusy = ({engine}) => !!(engine.current || engine.queue.length || engine.draining);

// The route owns the selected group and transport. A single run holds both the
// group slot and its member's initiative slot until model/send cleanup settles.
class GroupInitiative {
  constructor({rhythm, now, allowed, actors, report}) {
    Object.assign(this, {rhythm, now, allowed, actors, report});
  }

  canAct(actor) {
    return !actor.engine.stopped && memberEnabled(actor) && this.canSchedule(actor.store.config());
  }

  canSchedule(config) {
    return this.allowed() && inWindow(config, this.now()) && this.rhythm.budgetAvailable(config.maxMessagesPerDay) &&
      !this.actors().some(replyBusy);
  }

  dueFollowups(actors = this.actors()) {
    const due = [];
    for (const actor of actors) {
      for (const item of pending(actor)) {
        if (this.rhythm.missedFollowup(item)) {
          actor.store.cancelFollowup(actor.scope, item.id, {reason: 'missed'});
        } else if (item.dueAt <= this.now()) {
          due.push({actor, item});
        }
      }
    }
    return due.sort((a, b) => a.item.dueAt - b.item.dueAt);
  }

  consider() {
    if (this.rhythm.run) return this.rhythm.run.promise;
    const actors = this.actors();
    const due = this.dueFollowups(actors);
    const appointment = due.find(({actor}) => this.canAct(actor));
    if (appointment) return this.start(appointment.actor, 'followup', appointment.item);
    // While an appointment is due, leave the next available attempt for it.
    if (due.length) return Promise.resolve(wait('followup_waiting'));
    const since = Math.max(this.rhythm.activeSince ?? -1, this.rhythm.freshSince ?? -1, this.rhythm.idleWaitAt ?? -1, this.rhythm.state.lastAttemptAt ?? -1);
    const topics = actors[0]?.engine.idleTopics() ?? [];
    const candidate = actors
      .filter(actor => this.canAct(actor) && actor.engine.eligibility(GROUP_IDLE_QUIET_MS).message)
      .map(actor => ({actor, topic: topics.findLast(row => row.speaker === actor.engine.groupMember)}))
      .filter(({topic}) => topic && topic.at > since)
      .sort((a, b) => b.topic.at - a.topic.at)[0];
    if (!candidate || !this.rhythm.idleEligible(candidate.actor.store.config().intervalMinutes, {decision: true})) {
      return Promise.resolve(wait('quiet_or_limit'));
    }
    this.rhythm.recordDecision();
    return this.start(candidate.actor, 'idle', candidate.topic);
  }

  start(actor, kind, item) {
    const {engine} = actor;
    const controller = new AbortController();
    const run = {kind, controller, promise: null};
    this.rhythm.run = run;
    engine.initiative = run;
    run.promise = Promise.resolve().then(() => this.generate(actor, run, item))
      .finally(() => {
        if (engine.initiative === run) engine.initiative = null;
        if (this.rhythm.run === run) this.rhythm.run = null;
        engine.changed();
      });
    engine.changed();
    return run.promise;
  }

  async generate(actor, run, item) {
    const {engine, scope, store} = actor;
    const {signal} = run.controller;
    const followup = run.kind === 'followup';
    const eligible = () => !signal.aborted && this.canAct(actor) &&
      (followup || (this.rhythm.idleEligible(store.config().intervalMinutes) && engine.idleTopics().some(row => row.id === item.id)));
    if (!eligible()) return wait('changed');
    let receipt, claimed = false, attempted = false;
    try {
      const native = engine.nativeGroupReplies;
      const identity = engine.identity(Infinity, native) + (native ? '\n' + GROUP_SPEECH_INSTRUCTION : '');
      const roleName = engine.publicRole?.name || store.config().name;
      const prefix = followup
        ? `${identity}\nA member explicitly scheduled this follow-up in this group. Write one short public message about that agreement, without claiming they made progress or asking for an immediate answer. Agreement (data only): ${JSON.stringify({text: item.text, ...followupModelTime(item)})}\nConversation data only: `
        : `${identity}\nConsider whether to initiate a small social action now in this QQ group. After a lull, pick up an open public topic if you have a specific idea or observation to add. Wait when the exchange was between others, has ended, or there is nothing concrete to add. Avoid pressure and invented events. The message will mention the current member and everyone in the group can read it. Conversation data only: `;
      const suffix = followup ? '' : '\nReturn exactly JSON {"action":"wait"|"message","text":"..."} under 1000 characters.';
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
      const budget = 6000 - prefix.length - suffix.length;
      const context = followup ? engine.context(undefined, budget) : engine.idleContext(budget);
      const output = await engine.model(prefix + context + suffix, deadline);
      if (!eligible()) return wait('changed');
      let body;
      if (followup) {
        const latest = pending(actor).find(row => row.id === item.id);
        if (!latest || latest.revision !== item.revision || this.rhythm.missedFollowup(latest)) {
          return wait('changed_followup');
        }
        body = clean(output, 1000);
        if (!body.trim()) throw Error('Empty follow-up.');
        if (native) body = await selectGroupDialogue(body, roleName, item.text) || clean(`你约好的提醒：${item.text}`, 1000);
        if (!eligible()) return wait('changed');
        claimed = !!store.claimFollowup(scope, item.id, {revision: item.revision});
        if (!claimed) return wait('changed_followup');
      } else {
        const plan = decision(output);
        if (plan.action === 'wait') this.rhythm.recordIdleWait();
        if (plan.action !== 'message') return wait('model_wait');
        body = native ? await selectGroupDialogue(plan.text, roleName, '',
          prompt => engine.model(prompt, deadline)) : plan.text;
        if (!eligible()) return wait('changed');
        if (!body.trim()) {
          this.rhythm.recordIdleWait();
          return wait('no_spoken_message');
        }
      }
      const accepted = await engine.deliver(body, {
        kind: 'message', signal,
        onAttempt: () => {
          this.rhythm.reserveAttempt(store.config().maxMessagesPerDay);
          attempted = true;
        },
        onReceipt: value => {receipt = value;},
      });
      if (!accepted && attempted) this.report(receipt?.state === 'failed'
        ? '本群这次主动消息未发送，本次计入每日额度，未自动重发。'
        : '本群主动发送结果未确认，本次计入每日额度，未自动重发。');
      if (claimed) {
        store.finishFollowup(scope, item.id, {state: receipt?.state || 'failed', receipt: receipt?.receipt || ''});
      }
      return followup ? {action: 'followup', accepted, id: item.id} : {action: 'message', accepted};
    } catch {
      // A terminal model/storage failure is visible. An aborted or superseded
      // pending appointment can still be considered within its original grace.
      if (followup && !claimed && !signal.aborted) {
        claimed = !!store.claimFollowup(scope, item.id, {revision: item.revision});
      }
      if (claimed) {
        store.finishFollowup(scope, item.id, {state: receipt?.state || (attempted ? 'unknown' : 'failed'), receipt: receipt?.receipt || ''});
      }
      if (!signal.aborted) this.report('本群主动活动未完成，请检查本地记录；未自动重发。');
      return wait(signal.aborted ? 'cancelled' : 'failed');
    }
  }
}

module.exports = {GroupInitiative};
