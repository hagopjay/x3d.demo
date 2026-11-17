#!/usr/bin/env node
/* Integrity only. Matching hashes do not authenticate a publisher, prove a tool
   execution, detect a replaced whole notebook, or certify scene validity. */
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
function stable(value){
 if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Non-finite JSON numbers are not accepted');
 if(value&&typeof value==='object')return Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
function verify(notebook){
 if(!notebook||notebook.schema!=='semantic-twin-notebook/v1'||!Array.isArray(notebook.receipts))throw new Error('Expected a semantic-twin-notebook/v1 object');
 for(const [i,receipt]of notebook.receipts.entries()){
  if(!receipt||receipt.schema!=='semantic-twin-browser-witness/v1')throw new Error(`Receipt ${i} has an unsupported schema`);
  const {receipt_sha256,...body}=receipt;
  if(!/^[a-f0-9]{64}$/.test(receipt_sha256||'')||digest(body)!==receipt_sha256)throw new Error(`Receipt ${i} digest does not match`);
 }
 const {notebook_sha256,...body}=notebook;
 if(!/^[a-f0-9]{64}$/.test(notebook_sha256||'')||digest(body)!==notebook_sha256)throw new Error('Notebook digest does not match');
 return {ok:true,integrity_verified:true,receipts:notebook.receipts.length,authenticity_verified:false,execution_reproduced:false,note:'Checks the supplied JSON hashes using sorted-key JSON with JavaScript number serialization. No independent trust root, completeness anchor, engine rerun, or scene verdict is supplied.'};
}
module.exports={verify,digest};
if(require.main===module){try{if(process.argv.length!==3)throw new Error('Usage: node verify-notebook.js NOTEBOOK.json');console.log(JSON.stringify(verify(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));}catch(e){console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}}
