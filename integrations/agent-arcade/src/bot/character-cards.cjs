'use strict';

const {publicCatalog} = require('../core/personas.cjs');
const cardParser = require('../vendor/sillytavern/character-card-parser.cjs');
const {normalizeCard,toCardObject,revalidateCard} = require('../vendor/sillytavern/character-card.cjs');
const MAX_BYTES = 64 * 1024;
const bad = message => Object.assign(new Error(message), {code:'character_card_invalid'});
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
function bounded(value, max, label, required=false) {
  if(value===undefined || value===null) value='';
  if(typeof value!=='string' || value.length>max || /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) throw bad(`Invalid ${label}.`);
  value=value.trim();
  if(required&&!value) throw bad(`Missing ${label}.`);
  return value;
}
function examples(value) {
  if(value===undefined) return [];
  if(!Array.isArray(value)||value.length>6) throw bad('Use at most six speaking examples.');
  return value.map(item=>{
    if(!isObject(item)||Object.keys(item).some(key=>!['user','assistant'].includes(key))) throw bad('Invalid speaking example.');
    return {user:bounded(item.user,240,'example user',true),assistant:bounded(item.assistant,240,'example assistant',true)};
  });
}
function tavernExamples(value, warnings) {
  const raw=bounded(value,8000,'example dialogue');
  if(!raw) return [];
  const turns=[];
  const re=/(?:^|\n)\s*(?:<START>\s*)?(\{\{user\}\}|\{\{char\}\}|user|assistant)\s*:\s*([\s\S]*?)(?=\n\s*(?:<START>\s*)?(?:\{\{user\}\}|\{\{char\}\}|user|assistant)\s*:|$)/gi;
  for(const match of raw.matchAll(re)) turns.push({role:/user/i.test(match[1])?'user':'assistant',text:match[2].replace(/\s*<START>\s*$/g,'').trim()});
  const result=[];
  for(let i=0;i+1<turns.length&&result.length<6;i++) {
    if(turns[i].role!=='user'||turns[i+1].role!=='assistant') continue;
    if(turns[i].text.length>240||turns[i+1].text.length>240) {warnings.push('A speaking example exceeded 240 characters and was omitted.');continue;}
    if(turns[i].text&&turns[i+1].text) result.push({user:turns[i].text,assistant:turns[i+1].text});
    i++;
  }
  if(!result.length) warnings.push('Example dialogue did not contain supported user/character pairs. Add examples in the editor.');
  if(turns.length>12) warnings.push('Only the first six complete speaking examples were imported.');
  return result;
}
function validateCard(value) {
  if(!isObject(value)) throw bad('Invalid character card.');
  const known = new Set(['name','description','characterId','speechExamples','creator','version','license','sourceFormat']);
  if(Object.keys(value).some(key=>!known.has(key))) throw bad('Character cards contain only presentation fields.');
  const characterId=value.characterId||'sprout';
  if(!publicCatalog().some(item=>item.id===characterId)) throw bad('Choose an original character portrait.');
  const sourceFormat=value.sourceFormat||'arcade_character_v1';
  if(!['arcade_character_v1','chara_card_v2','chara_card_v3'].includes(sourceFormat)) throw bad('Unsupported source format.');
  return {
    name:bounded(value.name,40,'name',true),description:bounded(value.description,800,'public character description',true),characterId,
    speechExamples:examples(value.speechExamples),creator:bounded(value.creator,120,'creator'),
    version:bounded(value.version,40,'version'),license:bounded(value.license,120,'license'),sourceFormat,
  };
}
function parseCard(input,{fallbackCharacterId='sprout'}={}) {
  if(Buffer.isBuffer(input)) {
    try{input=new TextDecoder('utf-8',{fatal:true}).decode(input);}catch{throw bad('The character card is not valid UTF-8.');}
  }
  if(typeof input!=='string'||Buffer.byteLength(input,'utf8')>MAX_BYTES) throw bad('Choose a UTF-8 JSON character card smaller than 64 KiB.');
  let outer;
  try {outer=JSON.parse(input.replace(/^\uFEFF/,''));} catch {throw bad('The character card is not valid JSON.');}
  if(!isObject(outer)) throw bad('Invalid character card.');
  const warnings=[];
  if(outer.spec==='arcade_character_v1') {
    if(outer.spec_version!=='1.0'||!isObject(outer.data)) throw bad('Unsupported Agent Arcade character card version.');
    const card=validateCard(outer.data);
    return {card,warnings,format:outer.spec};
  }
  if(!['chara_card_v2','chara_card_v3'].includes(outer.spec)||!isObject(outer.data)) throw bad('Use an Agent Arcade, Character Card V2 or V3 JSON file.');
  if((outer.spec==='chara_card_v2'&&outer.spec_version!=='2.0')||(outer.spec==='chara_card_v3'&&outer.spec_version!=='3.0')) throw bad('Unsupported character card version.');
  const data=outer.data;
  const description=[bounded(data.description,6000,'description'),bounded(data.personality,3000,'personality'),bounded(data.scenario,3000,'scenario')].filter(Boolean).join('\n\n');
  if(description.length>800) throw bad('The public description, personality and scenario exceed 800 characters. Shorten them before importing.');
  for(const key of ['system_prompt','post_history_instructions','character_book','extensions','assets','tools','scripts'])
    if(data[key]&&!(isObject(data[key])&&Object.keys(data[key]).length===0)) warnings.push(`Ignored ${key}; cards cannot change tools, permissions or system instructions.`);
  if(data.first_mes||data.alternate_greetings?.length) warnings.push('Greetings are not sent automatically. The current conversation stays unchanged.');
  warnings.push('The existing original portrait is retained. External artwork and remote assets are not imported.');
  const creatorNotes=bounded(data.creator_notes,3000,'creator notes');
  const exportedLicense=/^Content license: ([^\r\n]{1,120})$/.exec(creatorNotes)?.[1]||'';
  const card=validateCard({name:data.name,description,characterId:fallbackCharacterId,speechExamples:tavernExamples(data.mes_example,warnings),
    creator:data.creator,version:data.character_version,license:exportedLicense,sourceFormat:outer.spec});
  if(!card.license) warnings.push('No reusable-content license was supplied. Check the creator’s terms before redistributing this card.');
  return {card,warnings:[...new Set(warnings)],format:outer.spec};
}
function cardToSettings(input) {
  const card=validateCard(input);
  return {name:card.name,description:card.description,characterId:card.characterId,speechExamples:card.speechExamples,
    cardMetadata:{creator:card.creator,version:card.version,license:card.license,sourceFormat:card.sourceFormat}};
}
function cardFromSettings(settings) {
  const metadata=settings.cardMetadata||{};
  return validateCard({name:settings.name,description:settings.description,characterId:settings.characterId,
    speechExamples:settings.speechExamples||[],creator:metadata.creator||'',version:metadata.version||'',license:metadata.license||'',sourceFormat:metadata.sourceFormat||'arcade_character_v1'});
}
function serializeCard(input,{format='arcade_character_v1'}={}) {
  const card=validateCard(input);
  if(format==='arcade_character_v1') return JSON.stringify({spec:format,spec_version:'1.0',data:card},null,2)+'\n';
  if(!['chara_card_v2','chara_card_v3'].includes(format)) throw bad('Unsupported export format.');
  const data={name:card.name,description:card.description,personality:'',scenario:'',first_mes:'',
    mes_example:card.speechExamples.map(item=>`<START>\n{{user}}: ${item.user}\n{{char}}: ${item.assistant}`).join('\n'),
    creator:card.creator,character_version:card.version,creator_notes:card.license?`Content license: ${card.license}`:'',
    system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],extensions:{}};
  if(format==='chara_card_v3') Object.assign(data,{group_only_greetings:[],assets:[]});
  return JSON.stringify({spec:format,spec_version:format==='chara_card_v3'?'3.0':'2.0',data},null,2)+'\n';
}
// Full Character Card V1/V2/V3 import and export (JSON or PNG). Unlike the presentation subset
// above, these carry greetings, system prompt, post-history instructions and the lorebook
// through as bounded DATA. Nothing from a card is executed; 'extensions' stays inert JSON.
const FULL_JSON_MAX_BYTES = cardParser.MAX_JSON_BYTES;
const FULL_PNG_MAX_BYTES = cardParser.MAX_PNG_BYTES;
function parseCardFile(buffer,{fileName=''}={}) {
  if(buffer instanceof Uint8Array&&!Buffer.isBuffer(buffer)) buffer=Buffer.from(buffer.buffer,buffer.byteOffset,buffer.byteLength);
  if(!Buffer.isBuffer(buffer)||!buffer.length) throw bad('Choose a character card file.');
  const png=cardParser.isPng(buffer);
  let jsonText;
  if(png) {
    if(buffer.length>FULL_PNG_MAX_BYTES) throw bad('Choose a PNG character card smaller than 16 MiB.');
    jsonText=cardParser.readCardFromPng(buffer);
  } else {
    if(buffer.length>FULL_JSON_MAX_BYTES) throw bad('Choose a JSON character card smaller than 2 MiB.');
    try{jsonText=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw bad('The character card is neither a PNG image nor UTF-8 JSON.');}
  }
  let outer;
  try{outer=JSON.parse(jsonText.replace(/^\uFEFF/,''));}catch{throw bad(png?'The character data embedded in the PNG is not valid JSON.':'The character card is not valid JSON.');}
  const card=normalizeCard(outer);
  const warnings=[...card.warnings];
  const extension=typeof fileName==='string'?/\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1].toLowerCase():'';
  if(extension&&extension!==(png?'png':'json')) warnings.push(`The file is named .${extension} but contains ${png?'a PNG image':'JSON'}.`);
  if(card.characterBook||Object.keys(card.extensions).length) warnings.push('Lorebook entries and extensions are stored as data. Scripts, tools and regex rules in a card are never run.');
  return {card,portrait:png?buffer:null,sourceFormat:png?'png':'json',warnings};
}
function exportCard(card,{format='v2',portraitPng=null}={}) {
  if(!['v2','v3'].includes(format)) throw bad('Unsupported export format.');
  const json=JSON.stringify(toCardObject(revalidateCard(card),format),null,2)+'\n';
  if(Buffer.byteLength(json,'utf8')>FULL_JSON_MAX_BYTES) throw bad('The character card exceeds 2 MiB.');
  if(portraitPng===null||portraitPng===undefined) return {json};
  return {png:cardParser.writeCardToPng(portraitPng,json)};
}
module.exports={MAX_BYTES,parseCard,validateCard,cardToSettings,cardFromSettings,serializeCard,
  FULL_JSON_MAX_BYTES,FULL_PNG_MAX_BYTES,parseCardFile,exportCard};
