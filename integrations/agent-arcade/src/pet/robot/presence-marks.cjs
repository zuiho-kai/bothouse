'use strict';
const {ACTIVITIES} = require('../presence.cjs');
const PROBE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Only the visible activity, unread mark and locally numbered turns cross
// into a robot renderer. A reminder cannot complete a cancelled chat turn.
class RobotMarks {
  constructor(state = {activity: 'idle', attention: false}) {
    this.state = {activity: state.activity, attention: state.attention === true};
    this.run = this.state.activity === 'thinking' ? 1 : 0;
    this.sampled = null;
  }
  observe(state) {
    if (!state || !ACTIVITIES.includes(state.activity) || typeof state.attention !== 'boolean') return false;
    if (state.activity === 'thinking' && this.state.activity !== 'thinking') this.run++;
    if (state.activity === 'speaking') {
      if (this.state.activity === 'thinking' && this.sampled?.run === this.run) this.sampled.completed = true;
    } else if (state.activity !== 'thinking') this.sampled = null;
    this.state = {activity: state.activity, attention: state.attention};
    return true;
  }
  sample(state, token) {
    if (!this.observe(state)) return null;
    const sample = {token, ...this.state};
    if (this.sampled?.completed) sample.completedRun = this.sampled.run;
    if (this.state.activity === 'thinking') {
      sample.thinkingRun = this.run;
      if (this.sampled?.run !== this.run) this.sampled = {run: this.run, completed: false};
    }
    return sample;
  }
}
module.exports = {RobotMarks, validProbe: token => typeof token === 'string' && token.length === 36 && PROBE.test(token)};
