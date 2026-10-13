// Read-only audit: one record for every Figma variable and each of its modes.
const fs = require('node:fs');
const main = require('../test/fixtures/figma-main.json');
const modeNames = require('../test/fixtures/figma-main-color-modes.json');
const cols = Object.fromEntries(main.collections.map(c => [c.id,c]));
const byId = Object.fromEntries(main.variables.map(v => [v.id,v]));
const read = p => JSON.parse(fs.readFileSync(p,'utf8'));
const flat = (o,p='',out={}) => {for(const [k,v] of Object.entries(o)){const n=p?p+'.'+k:k;if(v && typeof v==='object' && '$value' in v)out[n]=v.$value;else if(v && typeof v==='object')flat(v,n,out);}return out;};
const file = p => flat(read('design-tokens/'+p+'.json'));
const resolveFigma = (v,modes={},seen=[]) => {if(seen.includes(v.id))throw Error('Circular Figma alias');const c=cols[v.collectionId],mode=c.modes.find(m=>m.name===modes[c.name])||c.modes.find(m=>m.modeId===c.defaultModeId);const a=v.values[mode.modeId];return a?.type==='VARIABLE_ALIAS'?resolveFigma(byId[a.id],modes,[...seen,v.id]):a;};
const resolveSource = (value,values,seen=[]) => {
 if(typeof value!=='string')return value;
 let s=value.replace(/\{([^}]+)\}/g,(_,key)=>{if(seen.includes(key))throw Error('Circular source alias '+key);if(!(key in values))throw Error('Missing '+key);return resolveSource(values[key],values,[...seen,key]);});
 if(/^(floor\()?[-\d.\s+*/()]+$/.test(s))s=Function('floor','return '+s)(Math.floor);
 if(typeof s==='string'&& /^-?[\d.]+(px|%)?$/.test(s))return parseFloat(s)/(s.endsWith('%')?100:1);
 return s;
};
const contexts = (theme='theme',scheme='Light',size='medium',type='Primary') => Object.assign({},file('primitives/globals'),file('primitives/modes/size/global'),file('primitives/modes/size/'+size),file('primitives/modes/typography/size/'+size),file('primitives/modes/color-scheme/'+scheme.toLowerCase()+'/theme'),file('primitives/modes/color-scheme/'+scheme.toLowerCase()+'/konferansesenter'),file('primitives/modes/typography/'+type.toLowerCase()+'/'+theme),file('themes/'+theme),file('semantic/style'));
const rows=[];
for(const v of main.variables){const c=cols[v.collectionId],checks=[];for(const m of c.modes){let path,values,actual,expected=resolveFigma(v,{[c.name]:m.name}),note;
 try{
  if(c.name==='Color scheme'){path=`primitives/modes/color-scheme/${m.name.toLowerCase()}/${v.name.startsWith('konferansesenter/')?'konferansesenter':'theme'}`;values=file(path);}
  if(c.name==='Typography'){path=`primitives/modes/typography/${m.name.toLowerCase()}/${v.name.split('/')[0]}`;values=file(path);}
  if(c.name==='Theme'){path='themes/'+m.name;values=contexts(m.name);}
  if(c.name==='Semantic'){path='semantic/style';values=contexts();}
  if(c.name==='Color'){path='semantic/color/'+modeNames[m.name];values={...contexts(),...file(path)};}
  if(c.name==='Size'){path='primitives/modes/size/'+m.name;values=contexts('theme','Light',m.name);note='Generated source value; CSS size rounding is measured separately in the browser.';}
  if(v.name==='opacity/disabled')expected/=100;
  if(actual===undefined)actual=resolveSource(values[v.name.replaceAll('/','.')],values);
  if(v.name.endsWith('font-family') && typeof actual==='string'){actual=actual.replace(/^"(.*)"$/, '$1');note='CSS quoting does not change the font family.';}
  const pass=typeof expected==='number'&&typeof actual==='number'?Math.abs(expected-actual)<.001:actual===expected;
  checks.push({mode:m.name,expected,actual,pass,path,note});
 }catch(e){checks.push({mode:m.name,expected,pass:false,error:e.message,path});}
 }
 rows.push({id:v.id,name:v.name,collection:c.name,type:v.type,status:checks.every(c=>c.pass)?'source-values-match':'difference',checks});
}
fs.mkdirSync('audit/main-source-correction',{recursive:true});fs.writeFileSync('audit/main-source-correction/all-variable-checks.json',JSON.stringify({source:main.fileKey,capturedAt:main.capturedAt,variables:rows.length,checks:rows.reduce((n,r)=>n+r.checks.length,0),failures:rows.filter(r=>r.status!=='source-values-match'),rows},null,2)+'\n');
console.log(JSON.stringify({variables:rows.length,checks:rows.reduce((n,r)=>n+r.checks.length,0),failures:rows.filter(r=>r.status!=='source-values-match')},null,2));

if(rows.some(r=>r.status!=='source-values-match'))process.exitCode=1;
