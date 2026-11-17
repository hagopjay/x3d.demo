/* Main-thread watchdog: termination, rather than a timer inside the busy worker,
   makes synchronous reasoning cancellable. A new request reinitialises a worker. */
(function (G) {
  'use strict';
  class TwinWorkerClient {
    constructor({url='engine-worker.js',timeoutMs=20000}={}) { this.url=url;this.timeoutMs=timeoutMs;this.pending=new Map();this.seq=0;this.worker=null;this.initialising=null;this.closed=false; }
    _stop(message) { this.worker?.terminate();this.worker=null;this.initialising=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}this.pending.clear(); }
    _start() {
      if(this.closed)throw new Error('Worker client is closed');
      if(this.worker)return;
      if(typeof Worker==='undefined')throw new Error('Live semantic execution requires Web Workers. Readings and recorded evidence remain available.');
      const worker=new Worker(this.url);this.worker=worker;
      worker.onmessage=({data})=>{const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);data.ok?p.resolve(data.result):p.reject(new Error(data.error||'Worker operation failed'));};
      worker.onerror=()=>{if(this.worker===worker)this._stop('Semantic worker failed; retry to start a fresh worker.');};
    }
    _request(op,args) {this._start();return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>this._stop(`Operation exceeded ${this.timeoutMs/1000}s. Its worker was terminated; no completed verdict is claimed.`),this.timeoutMs);this.pending.set(id,{resolve,reject,timer});try{this.worker.postMessage({id,op,args});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
    init() { if(!this.initialising)this.initialising=this._request('init').catch(e=>{this.initialising=null;throw e;});return this.initialising; }
    async call(op,args) {if(op==='init')return this.init();await this.init();return this._request(op,args);}
    run(job,editText) {return this.call('run',{job,editText});}
    warm(){return this.call('warm');}
    preload(graphs){return this.call('preload',{graphs});}
    cancel(){this._stop('Operation cancelled. Its worker was terminated.');}
    dispose(){this.closed=true;this._stop('Worker client closed.');}
    get mode(){return this.worker?'worker · 20s watchdog':'worker not running';}
  }
  G.TwinWorkerClient=TwinWorkerClient;
})(typeof self==='undefined'?globalThis:self);
