'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {atomicJSON}=require('../core/files.cjs');
const {publicCatalog}=require('../core/personas.cjs');
const {CharacterLibrary}=require('./character-library.cjs');
const {LorebookLibrary}=require('./st/lorebooks.cjs');
const localSettings=require('./st/local-settings.cjs');
const {MAX_PNG_BYTES}=require('../vendor/sillytavern/character-card-parser.cjs');
const {scopeFor,stScopeFor}=require('./local-companion.cjs');

const digest=value=>createHash('sha256').update(value).digest('hex');
const keyOf=value=>process.platform==='win32'?value.toLowerCase():value;
const idPattern=/^[0-9a-f]{16}$/u;
const problem=code=>Object.assign(new Error(code),{code});
const safeText=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,80):'';
const within=(root,file)=>{
  const relative=path.relative(keyOf(root),keyOf(file));
  return relative===''||(!path.isAbsolute(relative)&&relative.split(path.sep)[0]!=='..');
};

function statEntry(file,type){
  let stat;
  try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(stat.isSymbolicLink()||keyOf(fs.realpathSync(file))!==keyOf(file)||!stat[type]())throw problem('linked_source');
  return stat;
}

function readJson(file,max){
  const stat=statEntry(file,'isFile');
  if(!stat)return null;
  if(stat.size>max)throw problem('invalid_source');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

function sourceProfiles(root){
  const registry=readJson(path.join(root,'companions.json'),65536);
  const accounts=registry?.accounts??[{root,name:'',id:'primary'}];
  if(!Array.isArray(accounts)||accounts.length>32)throw problem('invalid_source');
  const byRoot=new Map();
  let skipped=0;
  for(const item of accounts){
    try{
      if(!item||typeof item.root!=='string'||!path.isAbsolute(item.root))throw problem('invalid_source');
      const directory=path.resolve(item.root);
      if(!within(root,directory)||!statEntry(directory,'isDirectory')||byRoot.has(keyOf(directory)))throw problem('linked_source');
      byRoot.set(keyOf(directory),{root:directory,name:safeText(item.name)||'本地搭档',location:path.relative(root,directory)||'.',preferred:item.id===registry?.selectedId});
    }catch{skipped++;}
  }
  if(!byRoot.size)throw problem('invalid_source');
  return {profiles:[...byRoot.values()],skipped};
}

function readHistory(account, operation){
  const local=path.join(account,'local-companion');
  if(!statEntry(local,'isDirectory'))return operation(null);
  const file=path.join(local,'social-memory.sqlite');
  const fileStat=statEntry(file,'isFile');
  if(!fileStat)return operation(null);
  if(fileStat.size>256*1024*1024)throw problem('source_too_large');
  // The reader never checkpoints, repairs, or writes the old profile. A live WAL
  // or a rollback journal means the owner should exit the old app before retrying.
  for(const suffix of ['-wal','-journal','-shm'])if(statEntry(file+suffix,'isFile'))throw problem('source_busy');
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
  try{
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; BEGIN');
    const columns=new Set(db.prepare('PRAGMA table_info(messages)').all().map(row=>row.name));
    if(!['scope','id','role','text','at','speaker','greeting_chars'].every(name=>columns.has(name)))throw problem('unsupported_history');
    return operation(db);
  }finally{db.close();}
}

// Selection always resolves from an old account and exact old role ID. Unrelated
// SQLite scopes (QQ, other accounts, branches or groups) never enter this query.
const textOnly="speaker IS NULL AND role IN ('user','assistant') AND substr(id,1,17)!='local-in:drawing:' AND substr(id,1,18)!='local-out:command:'";
function stats(db,scope){
  if(!db)return {messages:0,omitted:0,lastAt:null};
  const {messages,total,lastAt}=db.prepare(`SELECT count(*) AS total,count(CASE WHEN ${textOnly} THEN 1 END) AS messages,max(at) AS lastAt FROM messages WHERE scope=?`).get(digest(scope));
  return {messages:Math.min(messages,120),omitted:total-Math.min(messages,120),lastAt};
}

function historyRows(db,scope){
  if(!db)return [];
  return db.prepare(`SELECT id,role,text,at,greeting_chars AS greetingChars FROM messages WHERE scope=? AND ${textOnly}
    ORDER BY at DESC,rowid DESC LIMIT 120`).all(digest(scope)).reverse().map(({greetingChars,...row})=>
      greetingChars===null?row:{...row,greetingChars});
}

function sourceBookSelection(account){
  const directory=path.join(account,'local-companion');
  if(!statEntry(directory,'isDirectory'))return null;
  const file=path.join(directory,'st-settings.json');
  if(!statEntry(file,'isFile'))return null;
  const {settings,problem}=localSettings.load(file);
  // RC64 stores one current selection per profile, not a list for every role.
  // Branches share their card's book settings. Groups and built-ins do not
  // establish a single library card's selection.
  if(problem||settings.groupId||!settings.characterId)return null;
  return {cardId:settings.characterId,lorebookIds:settings.lorebookIds,useCharacterBook:settings.useCharacterBook};
}

function openSource(picked,destination){
  const root=fs.realpathSync(path.resolve(picked));
  for(const target of [destination.home,destination.root]){
    if(within(root,target)||within(target,root))throw problem('same_source');
  }
  if(!['companions.json','bot-config.json','characters','lorebooks','local-companion'].some(name=>fs.existsSync(path.join(root,name))))throw problem('invalid_source');
  const cardsPath=path.join(root,'characters'),booksPath=path.join(root,'lorebooks');
  statEntry(cardsPath,'isDirectory');statEntry(booksPath,'isDirectory');
  const characters=new CharacterLibrary({root:cardsPath}),books=new LorebookLibrary({root:booksPath});
  const source=sourceProfiles(root), cards=characters.list(), lorebooks=books.list();
  for(const card of cards)statEntry(path.join(cardsPath,card.id),'isDirectory');
  const profiles=source.profiles.map(profile=>{
    let items,bookSelection;
    try{
      bookSelection=sourceBookSelection(profile.root);
      items=readHistory(profile.root,db=>[
        ...cards.map(card=>({key:'card:'+card.id,kind:'card',id:card.id,name:card.name,version:card.updatedAt,
          ...(cards.some(other=>other.id!==card.id&&other.name===card.name)&&{disambiguation:card.id.slice(-6)}),
          scope:stScopeFor(profile.root,card.id),...stats(db,stScopeFor(profile.root,card.id))})),
        ...publicCatalog().map(role=>({key:'role:'+role.id,kind:'role',id:role.id,name:role.name.zh,nameEn:role.name.en,
          scope:scopeFor(profile.root,role.id),...stats(db,scopeFor(profile.root,role.id))})).filter(item=>item.messages>0),
      ]);
    }catch(error){
      return {...profile,items:[],historyIssue:error.code||'invalid_source'};
    }
    return {...profile,items,bookSelection};
  });
  return {root,characters,books,profiles,skipped:source.skipped,lorebooks:lorebooks.map(book=>{
    const item={key:'book:'+book.id,kind:'book',id:book.id,name:book.name,version:book.updatedAt};
    const same=lorebooks.filter(other=>other.name===book.name);
    if(same.length>1){
      const entry=books.get(book.id)?.book.entries[0];
      const short=book.id.slice(-6);
      item.disambiguation=same.some(other=>other.id!==book.id&&other.id.endsWith(short))?book.id:short;
      item.excerpt=safeText(entry?.content).slice(0,48);
    }
    return item;
  })};
}

function reserve(library,file,key){
  const stored=readJson(file,512*1024)??{version:1,ids:{}};
  if(stored.version!==1||!stored.ids||Array.isArray(stored.ids)||typeof stored.ids!=='object')throw problem('invalid_ledger');
  if(stored.ids[key]!==undefined){
    if(!idPattern.test(stored.ids[key]))throw problem('invalid_ledger');
    return stored.ids[key];
  }
  let id;
  do id=randomBytes(8).toString('hex');while(library.get(id)||Object.values(stored.ids).includes(id));
  stored.ids[key]=id;
  // Reserve before writing either library or history. A retry after interruption
  // reuses this destination ID without matching by name or altering an edited card.
  atomicJSON(file,stored);
  return id;
}

function itemView({scope,version,id,...item}){return item;}
function previewView(plan){return {ok:true,token:plan.token,destination:plan.destination.name,profileId:plan.destination.id,skippedAccounts:plan.source.skipped,
  profiles:plan.source.profiles.map(({name,location,preferred,items,historyIssue,bookSelection})=>{
    const owner=items.find(item=>item.kind==='card'&&item.id===bookSelection?.cardId);
    return {name,location,preferred,historyIssue,items:items.map(itemView),
      bookOwner:owner&&[owner.name,owner.disambiguation].filter(Boolean).join(' · '),
      boundBooks:bookSelection?.lorebookIds.map(id=>'book:'+id)||[]};
  }),
  books:plan.source.lorebooks.map(itemView)};}

function sameTarget(a,b){return a&&b&&a.id===b.id&&a.root===b.root&&a.revision===b.revision&&a.service===b.service;}

function createLegacyCompanionImport({current,pick,characters,books,refresh}){
  let plan=null;
  return {
    async preview(){
      plan=null;
      const destination=current();
      if(!destination)return {ok:false,code:'changed'};
      try{
        const directory=await pick();
        if(!directory)return {ok:false,code:'cancelled'};
        if(!sameTarget(current(),destination))throw problem('changed');
        const source=openSource(directory,destination);
        plan={token:randomUUID(),destination,source};
        return previewView(plan);
      }catch(error){return {ok:false,code:error.code||'invalid_source'};}
    },
    apply(request){
      const active=plan;
      if(!active||request?.token!==active.token||!sameTarget(current(),active.destination))return {ok:false,code:'changed'};
      const {destination,source}=active;
      const profile=source.profiles[request.profile];
      if(!Number.isInteger(request.profile)||!profile||profile.historyIssue||!Array.isArray(request.items)||!request.items.length||request.items.length>260)return {ok:false,code:'invalid_selection'};
      const visible=new Map([...profile.items,...source.lorebooks].map(item=>[item.key,item]));
      const items=[...new Set(request.items)].map(key=>visible.get(key));
      if(items.some(item=>!item))return {ok:false,code:'invalid_selection'};
      try{destination.service.assertLocalStopped();}catch{return {ok:false,code:'busy'};}
      const ledger=path.join(destination.home,'companion-legacy-import.json');
      const historyNeeded=items.some(item=>item.messages>0);
      try{
        const transfer=from=>{
          if(JSON.stringify(profile.bookSelection)!==JSON.stringify(sourceBookSelection(profile.root)))throw problem('changed');
          const selectedBooks=new Map(),manager=destination.service.localManager();
          // Resolve actual destination IDs before exposing a role that depends on them.
          return [...items.filter(item=>item.kind==='book'),...items.filter(item=>item.kind!=='book')].map(item=>{
            try{
              const migration=digest(JSON.stringify([keyOf(source.root),keyOf(profile.root),keyOf(destination.root),item.key]));
              let id=item.id, status='imported';
              const {kind,name}=item;
              let selection={lorebookIds:[],useCharacterBook:true};
              if(kind==='card'){
                const card=source.characters.get(id);
                if(card?.updatedAt!==item.version||card?.name!==name)throw problem('changed');
                const portrait=source.characters.portraitPath(id);
                if(portrait&&(!statEntry(portrait,'isFile')||fs.statSync(portrait).size>MAX_PNG_BYTES))throw problem('invalid_source');
                id=reserve(characters,ledger,migration);
                if(profile.bookSelection?.cardId===item.id){
                  const selected=profile.bookSelection.lorebookIds.filter(oldId=>request.items.includes('book:'+oldId));
                  if(selected.some(oldId=>!selectedBooks.has(oldId)))throw problem('book_copy_failed');
                  selection={lorebookIds:selected.map(oldId=>selectedBooks.get(oldId)),useCharacterBook:profile.bookSelection.useCharacterBook};
                }
                manager.migratedLorebooks.import(id,selection,true);
                if(!characters.get(id))characters.add({card,portrait:portrait?fs.readFileSync(portrait):null,reservedId:id});
                else status='already_imported';
              }else if(kind==='book'){
                const book=source.books.get(id);
                if(book?.updatedAt!==item.version||book?.name!==name)throw problem('changed');
                id=reserve(books,ledger,digest(JSON.stringify([keyOf(source.root),item.key])));
                if(!books.get(id))books.add({...book,reservedId:id});
                else status='already_imported';
                selectedBooks.set(item.id,id);
              }
              let history=null;
              if(item.messages){
                const rows=historyRows(from,item.scope);
                if(rows.length!==item.messages||stats(from,item.scope).lastAt!==item.lastAt)throw problem('changed');
                const scope=kind==='card'?stScopeFor(destination.root,id):scopeFor(destination.root,id);
                history=manager.importLegacyHistory(scope,migration,rows);
              }
              if(kind!=='book'&&history!=='history_exists')manager.migratedLorebooks.import(id,selection,false);
              return {kind,name,id,status,history};
            }catch(error){return {kind:item.kind,name:item.name,status:'retry',code:error.code||'write_failed'};}
          });
        };
        const results=historyNeeded?readHistory(profile.root,transfer):transfer(null);
        refresh();
        return {ok:true,results};
      }catch(error){return {ok:false,code:error.code||'invalid_source'};}
    },
  };
}

module.exports={createLegacyCompanionImport};
