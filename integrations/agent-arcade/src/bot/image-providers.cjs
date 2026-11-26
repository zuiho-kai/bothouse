'use strict';
const {IMAGE_MODELS, DEFAULT_IMAGE_MODEL}=require('./openai-image-generator.cjs');

const {CLOUDFLARE_IMAGE_MODEL:CLOUDFLARE_MODEL}=require('./cloudflare-image-generator.cjs');

const OPENAI='openai', CLOUDFLARE='cloudflare';
const validImageProvider=id=>id===OPENAI||id===CLOUDFLARE;
const imageModels=id=>id===CLOUDFLARE?[CLOUDFLARE_MODEL]:IMAGE_MODELS;
const defaultImageModel=id=>id===CLOUDFLARE?CLOUDFLARE_MODEL:DEFAULT_IMAGE_MODEL;
const imageProviders=service=>[CLOUDFLARE,OPENAI].map(id=>({
  id, ready:!!service.stickerGenerationReady(id), models:imageModels(id), defaultModel:defaultImageModel(id)
}));

module.exports={OPENAI,CLOUDFLARE,CLOUDFLARE_MODEL,validImageProvider,imageModels,defaultImageModel,imageProviders};
