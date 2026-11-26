'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const {OPENAI,CLOUDFLARE,validImageProvider,imageModels,defaultImageModel,imageProviders}=require('./image-providers.cjs');
const {publicCatalog} = require('../core/personas.cjs');
const {drawingId} = require('./st/chat-drawings.cjs');

const visuals = new Map(publicCatalog().map(role => [role.id, role]));
const MAX_BYTES = 8 * 1024 * 1024;
const fail = code => Object.assign(Error('Character sticker: ' + code), {code});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const dataUrl = bytes => 'data:image/png;base64,' + bytes.toString('base64');

function stickerRole(state, language = 'zh') {
  const local = state?.local, st = state?.st;
  if (!local || !st || st.problem || st.group || st.settings?.groupId || local.libraryGroupId) return null;
  if (st.settings?.characterId || local.libraryCharacterId || st.character) {
    const card = st.character;
    if (!card?.name || !/^[0-9a-f]{16}$/.test(card.id) || card.id !== local.libraryCharacterId) return null;
    return {id:'card-' + card.id, name:card.name, visual:null};
  }
  const role = visuals.get(local.characterId);
  return role ? {id:role.id, name:role.name[language] || role.name.zh, visual:role.visual} : null;
}

function bounded(value, max, code) {
  if (typeof value !== 'string') throw fail(code);
  const text = value.normalize('NFC').trim();
  if (!text || Array.from(text).length > max || /\p{Cc}/u.test(text)) throw fail(code);
  return text;
}

function withLibrary(root, create, operation) {
  const file = path.join(root, 'character-stickers.sqlite');
  let db;
  try {
    if (create) fs.mkdirSync(root, {recursive:true, mode:0o700});
    const stat = fs.lstatSync(file, {throwIfNoEntry:false});
    if (stat && !stat.isFile()) throw fail('storage_unavailable');
    if (!stat && !create) throw fail('not_found');
    const {DatabaseSync} = require('node:sqlite');
    db = new DatabaseSync(path.toNamespacedPath(file), {readOnly:!create, allowExtension:false});
    if (create) db.exec(`CREATE TABLE IF NOT EXISTS stickers (
      role TEXT NOT NULL, name_key TEXT NOT NULL, name TEXT NOT NULL,
      draft_id TEXT NOT NULL, png BLOB NOT NULL, sha256 TEXT NOT NULL,
      PRIMARY KEY(role, name_key))`);
    return operation(db);
  } catch (error) {
    if (['duplicate_name','not_found','storage_unavailable','appearance_changed'].includes(error.code)) throw error;
    throw fail('storage_unavailable');
  } finally { db?.close(); }
}

function saveNamed(context, name, draft) {
  const nameKey = name.toLowerCase();
  return withLibrary(context.service.root, true, db => {
    const saved = db.prepare(`INSERT INTO stickers(role,name_key,name,draft_id,png,sha256) VALUES(?,?,?,?,?,?)
      ON CONFLICT(role,name_key) DO NOTHING`).run(context.role.id, nameKey, name, draft.id, draft.bytes, draft.sha256);
    if (saved.changes === 1) return {name, sha256:draft.sha256};
    const row = db.prepare('SELECT name,draft_id,sha256 FROM stickers WHERE role=? AND name_key=?').get(context.role.id, nameKey);
    if (row?.draft_id === draft.id && row.sha256 === draft.sha256) return {name:row.name, sha256:row.sha256};
    throw fail('duplicate_name');
  });
}

function readNamedSticker(root, roleId, name) {
  bounded(name, 40, 'invalid_name');
  return withLibrary(root, false, db => {
    const row = db.prepare('SELECT name, png, sha256 FROM stickers WHERE role=? AND name_key=? AND length(png) BETWEEN 1 AND ?')
      .get(roleId, name.toLowerCase(), MAX_BYTES);
    if (!row) throw fail('not_found');
    const bytes = Buffer.from(row.png);
    if (sha(bytes) !== row.sha256) throw fail('storage_unavailable');
    return {name:row.name, sha256:row.sha256, bytes};
  });
}

function findNamed(context, name) {
  const {name:savedName, sha256, bytes} = readNamedSticker(context.service.root, context.role.id, name);
  return {name:savedName, sha256, preview:dataUrl(bytes)};
}

function listNamedStickers(root, roleId, after) {
  const cursor = after == null ? '' : bounded(after, 40, 'invalid_name').toLowerCase();
  const pageSize = 48;
  try {
    return withLibrary(root, false, db => {
      const rows = db.prepare('SELECT name, sha256 FROM stickers WHERE role=? AND name_key>? AND length(png) BETWEEN 1 AND ? AND length(name) BETWEEN 1 AND 40 AND length(sha256)=64 ORDER BY name_key LIMIT ?')
        .all(roleId, cursor, MAX_BYTES, pageSize + 1);
      const items = rows.slice(0, pageSize).map(({name,sha256}) => {
        if (bounded(name, 40, 'storage_unavailable') !== name || !/^[0-9a-f]{64}$/.test(sha256)) throw fail('storage_unavailable');
        return {name,sha256};
      });
      return {items, nextAfter:rows.length > pageSize ? items.at(-1).name : null};
    });
  } catch (error) {
    if (error.code === 'not_found') return {items:[], nextAfter:null};
    throw error;
  }
}

function appearanceText(value) {
  if (typeof value !== 'string') throw fail('invalid_appearance');
  const text = value.replace(/\r\n?/g,'\n').normalize('NFC').trim();
  if (text.length > 300 || /[\p{Cc}]/u.test(text.replaceAll('\n',''))) throw fail('invalid_appearance');
  return text;
}

function cardAppearance(context, edit) {
  const {service,accountId,companionId,role} = context;
  if (!role.id.startsWith('card-') || !companionId) throw fail('invalid_request');
  const key = [accountId, companionId, role.id];
  try {
    return withLibrary(service.root, !!edit, db => {
      if (edit) {
        db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS sticker_appearance (
            account TEXT, companion TEXT, role TEXT, text TEXT NOT NULL,
            PRIMARY KEY(account, companion, role))`);
      } else if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sticker_appearance'").get()) return '';
      const saved = db.prepare('SELECT text FROM sticker_appearance WHERE account=? AND companion=? AND role=?').get(...key)?.text ?? '';
      if (!edit) return saved;
      if (edit.expected !== saved) throw fail('appearance_changed');
      if (edit.text) db.prepare('INSERT OR REPLACE INTO sticker_appearance VALUES(?,?,?,?)').run(...key,edit.text);
      else db.prepare('DELETE FROM sticker_appearance WHERE account=? AND companion=? AND role=?').run(...key);
      db.exec('COMMIT');
      return edit.text;
    });
  } catch (error) {
    if (!edit && error.code === 'not_found') return '';
    throw error;
  }
}

function cardTextOnly({service,accountId,role}, value) {
  try {
    return withLibrary(service.root, value !== undefined, db => {
      const key = [accountId,role.id];
      if (value !== undefined) {
        db.exec('CREATE TABLE IF NOT EXISTS sticker_text_only (account TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(account,role))');
        if (value) db.prepare('INSERT OR IGNORE INTO sticker_text_only VALUES(?,?)').run(...key);
        else db.prepare('DELETE FROM sticker_text_only WHERE account=? AND role=?').run(...key);
        return value;
      }
      return !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='sticker_text_only' AND type='table'").get() &&
        !!db.prepare('SELECT 1 FROM sticker_text_only WHERE account=? AND role=?').get(...key);
    });
  } catch (error) {
    if (value === undefined && error.code === 'not_found') return false;
    throw error;
  }
}

function drawingPrompt(role, text, appearance, reference) {
  const features = role.visual ? '\nPublic visual traits: ' + JSON.stringify(role.visual) : '';
  return 'Draw one expressive character sticker for the named fictional companion, with a clear silhouette and an uncluttered background. ' +
    'Use the following user brief for the expression and action.\nCharacter name: ' + JSON.stringify(role.name) + features +
    (reference ? '\nUse the attached card portrait as the visual reference for this character. Draw a new expression or action as requested.' : '') +
    (appearance ? '\nUser-specified appearance: ' + JSON.stringify(appearance) : '') + '\nUser brief: ' + JSON.stringify(text);
}

function preferredImageProvider(context, choice) {
  const {service,companionId,role}=context;
  const args=[companionId??role.id,role.id];
  try{
    return withLibrary(service.root,choice!==undefined,db=>{
      if(choice!==undefined){
        db.exec('CREATE TABLE IF NOT EXISTS sticker_provider(companion TEXT,role TEXT,provider TEXT,PRIMARY KEY(companion,role))');
        db.prepare('INSERT OR REPLACE INTO sticker_provider VALUES(?,?,?)').run(...args,choice);
        return choice;
      }
      if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sticker_provider'").get()){
        const row=db.prepare('SELECT provider FROM sticker_provider WHERE companion=? AND role=?').get(...args);
        if(row&&validImageProvider(row.provider))return row.provider;
      }
      return service.stickerGenerationReady(OPENAI)?OPENAI:CLOUDFLARE;
    });
  }catch(error){
    if(choice===undefined&&error.code==='not_found')return service.stickerGenerationReady(OPENAI)?OPENAI:CLOUDFLARE;
    throw error;
  }
}

class CharacterStickerStudio {
  constructor({getContext, canDecode, readReference}) { Object.assign(this,{getContext,canDecode,readReference}); this.seen = new Map(); }

  observe(state) {
    const next = this.getContext(state);
    const prev = this.context;
    if (next && prev && next.service === prev.service && next.accountId === prev.accountId &&
        next.role.id === prev.role.id && next.role.name === prev.role.name && next.epoch === prev.epoch &&
        next.generation === prev.generation && next.historyId === prev.historyId && next.companionId === prev.companionId) return prev;
    this.clear();
    this.seen.clear();
    this.repair = null;
    this.context = next ? {...next, scopeId:randomUUID()} : null;
    return this.context;
  }

  clear() {
    this.pending?.controller.abort();
    this.pending = null;
    this.draft = null;
  }

  snapshot(state) {
    const c = this.observe(state);
    if(!c)return null;
    let provider;
    try{provider=preferredImageProvider(c);}catch{return null;}
    return {accountId:c.accountId, scopeId:c.scopeId, roleName:c.role.name,
      roleKind:c.role.id.startsWith('card-') ? 'card' : 'builtin', hasImageAppearance:!!c.role.visual,
      provider,providers:imageProviders(c.service),canGenerate:c.service.stickerGenerationReady(provider),
      models:imageModels(provider),defaultModel:defaultImageModel(provider)};
  }

  capture(value) {
    const c = this.observe();
    if (!c || c.accountId !== value?.accountId || c.scopeId !== value?.scopeId) throw fail('changed');
    return c;
  }

  configureImages(value) {
    const c = this.capture(value);
    if(value.select===true){
      if(!validImageProvider(value.provider)||Object.keys(value).some(key=>!['accountId','scopeId','provider','select'].includes(key)))
        throw fail('invalid_request');
      preferredImageProvider(c,value.provider);
      this.clear();
      this.repair=null;
      return this.#imageSettingsResult(c);
    }
    if(value.provider===CLOUDFLARE){
      if(Object.keys(value).some(key=>!['accountId','scopeId','provider','cloudflareAccountId','apiToken'].includes(key)))
        throw fail('invalid_request');
      const previous=preferredImageProvider(c);
      c.service.configureCloudflareImageCredentials({accountId:value.cloudflareAccountId,apiToken:value.apiToken});
      // Installing another provider's credential never changes an existing choice.
      if(previous===CLOUDFLARE)preferredImageProvider(c,previous);
      return this.#imageSettingsResult(c);
    }
    if (value.provider!==undefined&&value.provider!==OPENAI ||
        !Object.hasOwn(value, 'key') || Object.keys(value).some(key=>!['accountId','scopeId','key','repair','provider'].includes(key)) ||
        (Object.hasOwn(value,'repair') && value.repair !== true)) throw fail('invalid_request');
    if (value.repair) {
      if (this.repair?.scopeId !== c.scopeId || this.repair.vault !== c.service.vaultFingerprint) throw fail('changed');
      c.service.configureStickerImageKey(value.key,{replace:true,expectedVault:this.repair.vault});
    } else c.service.configureStickerImageKey(value.key);
    this.repair = null;
    return value.provider===undefined?{canGenerate:c.service.stickerGenerationReady()} : this.#imageSettingsResult(c);
  }

  #imageSettingsResult(c){
    const provider=preferredImageProvider(c);
    return {provider,providers:imageProviders(c.service),canGenerate:c.service.stickerGenerationReady(provider),
      models:imageModels(provider),defaultModel:defaultImageModel(provider)};
  }

  appearance(value) {
    const c = this.capture(value);
    if (Object.keys(value).some(k => !['accountId','scopeId','text','expected'].includes(k)) ||
        Object.hasOwn(value,'text') !== Object.hasOwn(value,'expected')) throw fail('invalid_request');
    const edit = Object.hasOwn(value,'text') ? {text:appearanceText(value.text),expected:appearanceText(value.expected)} : null;
    return {text:cardAppearance(c,edit)};
  }

  async reference(value) {
    const c = this.capture(value);
    if (!c.companionId || !c.role.id.startsWith('card-') || !this.readReference ||
        Object.keys(value).some(k=>!['accountId','scopeId','textOnly'].includes(k)) ||
        (Object.hasOwn(value,'textOnly') && typeof value.textOnly !== 'boolean')) throw fail('invalid_request');
    const textOnly = cardTextOnly(c,value.textOnly);
    const bytes = textOnly ? null : await this.readReference(c.role.id.slice(5));
    this.capture(value);
    return {textOnly, digest:bytes ? sha(bytes) : null};
  }

  async generate(value) {
    const c = this.capture(value);
    const {requestId, model} = value;
    const provider=preferredImageProvider(c);
    if (typeof requestId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId) ||
        !imageModels(provider).includes(model) || value.provider!==undefined&&value.provider!==provider) throw fail('invalid_request');
    const kind = value.kind === undefined ? 'sticker' : value.kind;
    if (!['sticker','illustration'].includes(kind) || (value.fromChat !== undefined && typeof value.fromChat !== 'boolean')) throw fail('invalid_request');
    const prompt = bounded(value.prompt, 500, 'invalid_request');
    let appearance = '';
    if (Object.hasOwn(value,'appearance')) {
      if (kind !== 'sticker' || !c.role.id.startsWith('card-')) throw fail('invalid_request');
      appearance = appearanceText(value.appearance);
      if (cardAppearance(c) !== value.expectedAppearance) throw fail('appearance_changed');
    }
    let chatText = null;
    if (value.fromChat) {
      chatText = value.chatText === undefined ? prompt : value.chatText;
      if (typeof chatText !== 'string' || !chatText.trim() || chatText.length > 2000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(chatText)) throw fail('invalid_request');
      if (!c.historyId) throw fail('changed');
    }
    const referenceDigest = value.referenceDigest;
    if (referenceDigest !== undefined && (kind !== 'sticker' || !c.companionId || !c.role.id.startsWith('card-') ||
        typeof referenceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(referenceDigest) || !this.readReference)) throw fail('invalid_request');
    const requestKey = sha(JSON.stringify([kind, model, prompt, chatText, ...(appearance ? [appearance] : []),
      ...(referenceDigest ? [{referenceDigest}] : [])]));
    if (this.seen.has(requestId) && this.seen.get(requestId) !== requestKey) throw fail('invalid_request');
    if (this.pending?.id === requestId) return this.pending.operation;
    if (this.pending) throw fail('busy');
    if (this.draft?.requestId === requestId) return this.preview(c);
    if (chatText !== null) {
      const stored = c.service.localManager().readDrawing(c.historyId, drawingId(requestId), requestKey);
      if (stored) {
        this.seen.set(requestId,requestKey);
        this.draft = {id:requestId, requestId, requestKey, fromChat:true, chatText:null, ...stored};
        return this.preview(c);
      }
    }
    if (this.seen.has(requestId)) throw fail('cancelled');
    if (!c.service.stickerGenerationReady(provider)) throw fail('credentials_missing');
    const vault = c.service.vaultFingerprint;
    this.repair = null;
    const run = {id:requestId, controller:new AbortController()};
    this.seen.set(requestId,requestKey);
    this.draft = null;
    this.pending = run;
    run.operation = (async () => {
      try {
        let reference;
        if (referenceDigest) {
          reference = await this.readReference(c.role.id.slice(5),run.controller.signal);
          this.capture(value);
          if (this.pending !== run || run.controller.signal.aborted) throw fail('cancelled');
          if (!reference || sha(reference) !== referenceDigest || cardTextOnly(c) ||
              (appearance && cardAppearance(c) !== value.expectedAppearance)) throw fail('changed');
        }
        const assertCurrent=()=>{
          this.capture(value);
          if(this.pending!==run||run.controller.signal.aborted||preferredImageProvider(c)!==provider||
             c.service.vaultFingerprint!==vault)throw fail('cancelled');
        };
        assertCurrent();
        const bytes = await c.service.generateCharacterSticker({model, prompt:kind === 'illustration' ? prompt :
          drawingPrompt(c.role, prompt, appearance, reference), signal:run.controller.signal,
          ...(provider===CLOUDFLARE&&{provider,assertCurrent}), ...(reference ? {reference} : {})});
        assertCurrent();
        if (appearance && cardAppearance(c) !== value.expectedAppearance) throw fail('appearance_changed');
        if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES || !this.canDecode(bytes)) throw fail('image_invalid_response');
        this.draft = {id:value.fromChat ? requestId : randomUUID(), requestId, requestKey, fromChat:value.fromChat===true, chatText, bytes, sha256:sha(bytes)};
        return this.preview(c);
      } catch (error) {
        if (provider===OPENAI&&['image_auth','image_forbidden'].includes(error?.code) && this.pending === run &&
            typeof vault === 'string' && c.service.vaultFingerprint === vault && this.observe() === c) {
          this.repair = {scopeId:c.scopeId,vault};
        }
        throw error;
      } finally { if (this.pending === run) this.pending = null; }
    })();
    return run.operation;
  }

  recordHistory(c,retry=false) {
    const draft = this.draft;
    if(retry&&draft.chatText===null){
      const stored=c.service.localManager().readDrawing(c.historyId,drawingId(draft.requestId));
      if(stored?.sha256!==draft.sha256)throw fail('changed');
    }
    if (draft.chatText !== null) {
      c.service.localManager().recordDrawing(c.historyId, draft.requestId, draft.chatText,
        c.language === 'en' ? 'Generated an image preview.' : '已生成绘图预览。', {bytes:draft.bytes,requestKey:draft.requestKey}, {retry});
      draft.chatText = null;
      if (this.observe() !== c || this.draft !== draft) throw fail('changed');
    }
  }

  retryHistory(value) {
    const c=this.capture(value);
    if (Object.keys(value).some(key=>!['accountId','scopeId','draftId'].includes(key))) throw fail('invalid_request');
    if (!this.draft?.fromChat || this.draft.id!==value.draftId) throw fail('changed');
    this.recordHistory(c,true);
    return {historySaved:true};
  }

  preview(c) {
    const draft=this.draft;
    let historySaved=true;
    try { this.recordHistory(c); }
    catch (error) {
      if (!['storage_unavailable','scope_limit'].includes(error?.code)) throw error;
      historySaved=false;
    }
    return {draftId:draft.id, sha256:draft.sha256, preview:dataUrl(draft.bytes), ...(historySaved ? {} : {historySaved:false})};
  }

  save(value) {
    const c = this.capture(value);
    if (!this.draft || value.draftId !== this.draft.id) throw fail('changed');
    return saveNamed(c, bounded(value.name, 40, 'invalid_name'), this.draft);
  }

  lookup(value) { return findNamed(this.capture(value), bounded(value.name, 40, 'invalid_name')); }

  list(value) {
    const c = this.capture(value);
    if (Object.keys(value).some(key => !['accountId','scopeId','after'].includes(key))) throw fail('invalid_request');
    return listNamedStickers(c.service.root, c.role.id, value.after);
  }

  discard(value) {
    this.capture(value);
    if (typeof value.requestId === 'string' && (this.pending?.id === value.requestId || this.draft?.requestId === value.requestId)) this.clear();
    return {};
  }
}

async function stickerResult(operation) {
  try { return {ok:true, ...await operation()}; }
  catch (error) {
    const known = ['changed','cancelled','busy','duplicate_name','not_found','invalid_name','invalid_request','invalid_key',
      'credentials_missing','credentials_busy','credentials_locked','already_configured','storage_unavailable','scope_limit','invalid_appearance','appearance_changed'];
    const code = known.includes(error?.code) || /^image_[a-z_]+$/.test(error?.code || '') ? error.code : 'provider_failed';
    return {ok:false, code};
  }
}

module.exports = {CharacterStickerStudio, stickerRole, stickerResult, listNamedStickers, readNamedSticker};
