'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verify,digest}=require('../verify-notebook.js');
function fixture(){const r={schema:'semantic-twin-browser-witness/v1',result:{list:[1,1,1],focus:'Ruby'},operation:'test'};r.receipt_sha256=digest(r);const n={schema:'semantic-twin-notebook/v1',receipts:[r]};n.notebook_sha256=digest(n);return n;}
test('notebook verification checks each receipt and explicitly makes no authenticity claim',()=>{const out=verify(fixture());assert.equal(out.integrity_verified,true);assert.equal(out.authenticity_verified,false);assert.equal(out.execution_reproduced,false);});
test('changed results fail even if the outer notebook hash is recomputed',()=>{const n=fixture();n.receipts[0].result.list[0]=2;delete n.notebook_sha256;n.notebook_sha256=digest(n);assert.throws(()=>verify(n),/Receipt 0/);});
test('changed notebook metadata and non-finite numbers are refused',()=>{const n=fixture();n.receipts=[];assert.throws(()=>verify(n),/Notebook/);assert.throws(()=>digest({x:Infinity}),/Non-finite/);});
