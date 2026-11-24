'use strict';

const AI_NUMBER='arcade_whale';
const AI_DRAGON_NUMBER='arcade_dragon';
const AI_JU_NUMBER='arcade_ju';
const providerForRole=new Map([
  [AI_NUMBER,'deepseek'],[AI_DRAGON_NUMBER,'openai'],[AI_JU_NUMBER,'anthropic'],
]);

module.exports={AI_NUMBER,AI_DRAGON_NUMBER,AI_JU_NUMBER,providerForRole};
