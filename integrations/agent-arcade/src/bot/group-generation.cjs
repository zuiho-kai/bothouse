'use strict';

const {RANGES, sampling: normalizeSampling} = require('./generation.cjs');

const FIELDS = Object.keys(RANGES);
const MAX_TOKENS_ONLY = ['maxTokens'];
// Reply defaults match the bounded requests emitted by the current runners.
// Gate caps are independent of the owner's formal-reply settings.
const MODES = new Map([
  ['deepseek', {fields: FIELDS, replyTokens: 4096, gateTokens: 256}],
  ['gemini', {fields: FIELDS, replyTokens: 8192, gateTokens: 512}],
  ['doubao', {fields: FIELDS, replyTokens: 4096, gateTokens: 256}],
  ['gpt', {fields: MAX_TOKENS_ONLY, replyTokens: 8192, gateTokens: 1024}],
  // Opus 5.5 counts adaptive thinking and the final decision in this budget.
  ['api', {fields: MAX_TOKENS_ONLY, replyTokens: 16000, gateTokens: 2048}],
]);

function groupGenerationView(mode, values) {
  const sampling = normalizeSampling(values);
  const provider = MODES.get(mode);
  const fields = provider?.fields ?? [];
  const unsupported = FIELDS.filter(key => !fields.includes(key));
  const effective = {
    temperature: fields.includes('temperature') ? sampling.temperature ?? null : null,
    topP: fields.includes('topP') ? sampling.topP ?? null : null,
    maxTokens: provider ? sampling.maxTokens ?? provider.replyTokens : null,
  };
  return {sampling, effective, unsupported};
}

function groupReplySampling(mode, values) {
  const selected = normalizeSampling(values);
  const fields = MODES.get(mode)?.fields ?? [];
  return Object.fromEntries(Object.entries(selected).filter(([key]) => fields.includes(key)));
}

function groupGateSampling(mode) {
  const provider = MODES.get(mode);
  return provider ? Object.freeze({maxTokens: provider.gateTokens}) : undefined;
}

module.exports = {groupGenerationView, groupReplySampling, groupGateSampling};
