// profiler.js - frame profiler for the A Material Odyssey WebGPU engine (three.js 0.186.1)
//
//  - CPU ms per frame (begin()..end() around update + submit) and the frame interval (rAF to rAF)
//  - GPU ms per frame from timestamp queries (WebGPU 'timestamp-query' feature, or WebGL2
//    EXT_disjoint_timer_query_webgl2) via renderer.resolveTimestampsAsync(), polled at 6 Hz (pool holds 2048 queries).
//    Every pass of every frame since the last poll is attributed to its frame (uid ':f<frame>').
//  - p50 / p95 / p99 over a rolling window (default 240 frames), fps, draw calls, triangles,
//    geometries, textures, programs, render scale, backend (WebGPU or WebGL2) and adapter info.
//  - bench(engine, opts): fixed-timestep playback of the film; per-shot table (frames, ms
//    p50/p95/max, GPU ms, draw calls, triangles), each frame waited to GPU completion.
//
// Hot path (begin/end) allocates nothing: ring buffers are Float64Arrays, percentiles are computed
// only when stats() is called (HUD at 4 Hz), into a preallocated scratch array and result object.

const NOW = () => performance.now();

class Ring {
	constructor( n ) { this.a = new Float64Array( n ); this.n = n; this.i = 0; this.count = 0; }
	push( v ) { this.a[ this.i ] = v; this.i = ( this.i + 1 ) % this.n; if ( this.count < this.n ) this.count ++; }
	clear() { this.i = 0; this.count = 0; }
	last() { return this.count ? this.a[ ( this.i - 1 + this.n ) % this.n ] : 0; }
	/** Writes { mean, p50, p95, p99, max } of the current window into out, using scratch (Float64Array n). */
	summarize( out, scratch ) {
		const c = this.count;
		if ( c === 0 ) { out.mean = out.p50 = out.p95 = out.p99 = out.max = 0; out.n = 0; return out; }
		let s = 0;
		for ( let k = 0; k < c; k ++ ) { const v = this.a[ k ]; scratch[ k ] = v; s += v; }
		const view = scratch.subarray( 0, c ); // a view object, only at HUD rate
		view.sort();
		const q = ( p ) => view[ Math.min( c - 1, Math.max( 0, Math.ceil( p * c ) - 1 ) ) ];
		out.n = c; out.mean = s / c; out.p50 = q( 0.5 ); out.p95 = q( 0.95 ); out.p99 = q( 0.99 ); out.max = view[ c - 1 ];
		return out;
	}
}

function emptySummary() { return { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 }; }

/** Backend and adapter facts (strings only; no identifiers beyond what the browser exposes). */
export function describeBackend( renderer ) {
	const b = renderer.backend;
	const out = { backend: b && b.isWebGPUBackend ? 'WebGPU' : 'WebGL2', vendor: '', architecture: '', device: '', description: '', fallback: false, timestamps: !! ( b && b.trackTimestamp ), software: false };
	try {
		if ( b && b.isWebGPUBackend && b.device ) {
			const ai = b.device.adapterInfo || {};
			out.vendor = ai.vendor || ''; out.architecture = ai.architecture || ''; out.device = ai.device || ''; out.description = ai.description || '';
			out.fallback = !! ai.isFallbackAdapter;
		} else if ( b && b.gl ) {
			const gl = b.gl, ext = gl.getExtension( 'WEBGL_debug_renderer_info' );
			out.vendor = ext ? gl.getParameter( ext.UNMASKED_VENDOR_WEBGL ) : gl.getParameter( gl.VENDOR );
			out.description = ext ? gl.getParameter( ext.UNMASKED_RENDERER_WEBGL ) : gl.getParameter( gl.RENDERER );
		}
	} catch ( e ) { /* adapter info is optional */ }
	const txt = ( out.vendor + ' ' + out.architecture + ' ' + out.description ).toLowerCase();
	out.software = out.fallback || /swiftshader|llvmpipe|software|warp|basic render/.test( txt );
	return out;
}

export class Profiler {
	constructor( renderer, { window = 240, pollHz = 6 } = {} ) {
		this.renderer = renderer;
		this.window = window;
		this.cpu = new Ring( window ); // ms spent in update + render submit
		this.interval = new Ring( window ); // ms between frame starts (what the viewer sees)
		this.gpu = new Ring( window ); // ms of GPU work per frame (timestamp queries)
		this.gpuCompute = new Ring( window );
		this._scratch = new Float64Array( window );
		this._t0 = 0; this._lastStart = 0;
		this.frames = 0;
		this.pollMs = 1000 / pollHz;
		this._lastPoll = 0;
		this._polling = false;
		this._lastGpuFrame = - 1; this._lastComputeFrame = - 1;
		this.renderScale = 1;
		this.backend = describeBackend( renderer );
		this.timestamps = this.backend.timestamps;
		this._stats = { cpu: emptySummary(), interval: emptySummary(), gpu: emptySummary(), gpuCompute: emptySummary(), fps: 0, drawCalls: 0, triangles: 0, points: 0,
			geometries: 0, textures: 0, programs: 0, renderTargets: 0, renderScale: 1, backend: this.backend, frames: 0, gpuSamples: 0 };
		this.lastDrawCalls = 0; this.lastTriangles = 0; this.lastPoints = 0;
	}
	/** Call at the very start of a frame (before world update). */
	begin( now = NOW() ) {
		if ( this._lastStart > 0 ) { const dt = now - this._lastStart; if ( dt > 0 && dt < 5000 ) this.interval.push( dt ); }
		this._lastStart = now; this._t0 = now;
	}
	/** Call after the frame's last render() call was submitted. */
	end( now = NOW() ) {
		this.cpu.push( now - this._t0 );
		this.frames ++;
		const r = this.renderer.info.render;
		this.lastDrawCalls = r.drawCalls; this.lastTriangles = r.triangles; this.lastPoints = r.points;
		if ( this.timestamps && now - this._lastPoll >= this.pollMs && ! this._polling ) { this._lastPoll = now; this.pollGPU(); }
	}
	/** Resolve timestamp queries; attribute every resolved pass to its frame. Runs at pollHz, not per frame. */
	async pollGPU() {
		if ( ! this.timestamps || this._polling ) return 0;
		this._polling = true;
		try {
			const b = this.renderer.backend;
			await this.renderer.resolveTimestampsAsync( 'render' );
			this._drainPool( b.timestampQueryPool && b.timestampQueryPool.render, this.gpu, '_lastGpuFrame' );
			if ( b.timestampQueryPool && b.timestampQueryPool.compute ) {
				await this.renderer.resolveTimestampsAsync( 'compute' );
				this._drainPool( b.timestampQueryPool.compute, this.gpuCompute, '_lastComputeFrame' );
			}
		} catch ( e ) { /* timestamps are best effort */ }
		this._polling = false;
		return this.gpu.last();
	}
	_drainPool( pool, ring, lastKey ) {
		if ( ! pool || ! pool.timestamps || pool.timestamps.size === 0 ) return;
		// sum pass durations per frame id, frames in ascending order
		const per = this._perFrame || ( this._perFrame = new Map() );
		per.clear();
		for ( const [ uid, ms ] of pool.timestamps ) {
			const k = uid.lastIndexOf( ':f' );
			const f = k >= 0 ? + uid.slice( k + 2 ) : 0;
			per.set( f, ( per.get( f ) || 0 ) + ms );
		}
		const frames = [ ...per.keys() ].sort( ( a, b ) => a - b );
		// the newest frame can be partial if a frame straddled the resolve; it is complete because the pool
		// resolves only submitted work, so keep all of them
		for ( const f of frames ) { if ( f > this[ lastKey ] ) { ring.push( per.get( f ) ); this[ lastKey ] = f; } }
	}
	/** Rolling statistics (allocation-free apart from a subarray view per ring). */
	stats() {
		const s = this._stats, info = this.renderer.info;
		this.cpu.summarize( s.cpu, this._scratch );
		this.interval.summarize( s.interval, this._scratch );
		this.gpu.summarize( s.gpu, this._scratch );
		this.gpuCompute.summarize( s.gpuCompute, this._scratch );
		s.fps = s.interval.mean > 0 ? 1000 / s.interval.mean : 0;
		s.drawCalls = this.lastDrawCalls; s.triangles = this.lastTriangles; s.points = this.lastPoints;
		s.geometries = info.memory.geometries; s.textures = info.memory.textures; s.programs = info.memory.programs; s.renderTargets = info.memory.renderTargets;
		s.renderScale = this.renderScale; s.frames = this.frames; s.gpuSamples = this.gpu.count;
		return s;
	}
	reset() { this.cpu.clear(); this.interval.clear(); this.gpu.clear(); this.gpuCompute.clear(); this._lastStart = 0; this.frames = 0; }
	/** Multi-line HUD text (call at HUD rate only). */
	hudText( extra = '' ) {
		const s = this.stats(), b = this.backend, f = ( v ) => v.toFixed( 2 );
		const adapter = [ b.vendor, b.architecture, b.description ].filter( Boolean ).join( ' / ' ) || 'n/a';
		return [
			`${ b.backend }${ b.software ? ' (software adapter)' : '' }  ${ adapter }`,
			`fps ${ s.fps.toFixed( 1 ) }  frame p50 ${ f( s.interval.p50 ) }  p95 ${ f( s.interval.p95 ) }  p99 ${ f( s.interval.p99 ) } ms`,
			`cpu p50 ${ f( s.cpu.p50 ) }  p95 ${ f( s.cpu.p95 ) }  p99 ${ f( s.cpu.p99 ) } ms`,
			this.timestamps ? `gpu p50 ${ f( s.gpu.p50 ) }  p95 ${ f( s.gpu.p95 ) }  p99 ${ f( s.gpu.p99 ) } ms${ s.gpuCompute.n ? `  compute ${ f( s.gpuCompute.p50 ) } ms` : '' }` : 'gpu timestamps: not supported by this adapter',
			`draws ${ s.drawCalls }  tris ${ ( s.triangles / 1000 ).toFixed( 1 ) }k  tex ${ s.textures }  progs ${ s.programs }  scale ${ s.renderScale.toFixed( 2 ) }`,
			extra
		].filter( Boolean ).join( '\n' );
	}
}

/** Wait until the GPU has finished all submitted work (used by bench only). */
export async function gpuIdle( renderer ) {
	const b = renderer.backend;
	if ( b && b.isWebGPUBackend && b.device ) { await b.device.queue.onSubmittedWorkDone(); return; }
	if ( b && b.gl ) {
		const gl = b.gl, px = new Uint8Array( 4 );
		gl.readPixels( 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px ); // forces completion
	}
}

function pct( sorted, p ) { return sorted.length ? sorted[ Math.min( sorted.length - 1, Math.max( 0, Math.ceil( p * sorted.length ) - 1 ) ) ] : 0; }

/**
 * Fixed-timestep bench of the film.
 * engine must expose: renderer, film (film.json object), duration, renderAt(t) (deterministic: set clock, update, render).
 * opts: { dt = 1/30, t0 = 0, t1 = duration, shots = null (array of shot indices), warmup = 3, onFrame(i, n, t) }
 * Returns { rows: [per shot], total, dt, frames, wall_s, backend, renderScale, size }.
 */
export async function bench( engine, opts = {} ) {
	const renderer = engine.renderer, film = engine.film || { shots: [] };
	const dt = opts.dt || 1 / 30;
	const T0 = opts.t0 != null ? opts.t0 : 0, T1 = opts.t1 != null ? opts.t1 : engine.duration;
	const shots = film.shots && film.shots.length ? film.shots : [ { name: 'film', t0: 0, t1: engine.duration } ];
	const pick = opts.shots ? new Set( opts.shots ) : null;
	const prof = new Profiler( renderer, { window: 16 } );
	const timestamps = prof.timestamps;
	const rows = shots.map( ( s, i ) => ( { i, name: s.name, t0: s.t0, t1: s.t1, kind: s.kind || '', frames: 0, wall: [], cpu: [], gpu: [], draws: 0, tris: 0 } ) );
	const shotAt = ( t ) => { for ( let i = 0; i < shots.length; i ++ ) if ( t >= shots[ i ].t0 && t < shots[ i ].t1 ) return i; return shots.length - 1; };
	const prevAuto = renderer.info.autoReset;
	renderer.info.autoReset = false;
	const wasPlaying = engine.playing;
	if ( engine.pause ) engine.pause();
	const wallStart = NOW();
	// warm-up (pipelines, shadow maps, history buffers)
	for ( let w = 0; w < ( opts.warmup ?? 3 ); w ++ ) { renderer.info.reset(); engine.renderAt( T0 ); await gpuIdle( renderer ); }
	let frames = 0;
	const times = [];
	for ( let t = T0; t < T1 - 1e-9; t += dt ) times.push( t );
	for ( let k = 0; k < times.length; k ++ ) {
		const t = times[ k ], si = shotAt( t );
		if ( pick && ! pick.has( si ) ) continue;
		renderer.info.reset();
		const a = NOW();
		engine.renderAt( t );
		const b = NOW();
		await gpuIdle( renderer );
		const c = NOW();
		let g = 0;
		if ( timestamps ) {
			try { g = ( await renderer.resolveTimestampsAsync( 'render' ) ) || 0; if ( renderer.backend.timestampQueryPool && renderer.backend.timestampQueryPool.compute ) g += ( await renderer.resolveTimestampsAsync( 'compute' ) ) || 0; } catch ( e ) { g = 0; }
		}
		const row = rows[ si ];
		row.frames ++; row.wall.push( c - a ); row.cpu.push( b - a ); if ( g > 0 ) row.gpu.push( g );
		row.draws += renderer.info.render.drawCalls; row.tris += renderer.info.render.triangles;
		frames ++;
		if ( opts.onFrame ) opts.onFrame( frames, times.length, t );
	}
	renderer.info.autoReset = prevAuto;
	const fin = ( arr ) => { const s = Float64Array.from( arr ).sort(); return { mean: s.length ? s.reduce( ( x, y ) => x + y, 0 ) / s.length : 0, p50: pct( s, 0.5 ), p95: pct( s, 0.95 ), max: s.length ? s[ s.length - 1 ] : 0 }; };
	const all = { wall: [], cpu: [], gpu: [] };
	const out = rows.filter( ( r ) => r.frames > 0 ).map( ( r ) => {
		all.wall.push( ...r.wall ); all.cpu.push( ...r.cpu ); all.gpu.push( ...r.gpu );
		const w = fin( r.wall ), c = fin( r.cpu ), g = fin( r.gpu );
		return { shot: r.name, t0: r.t0, t1: r.t1, kind: r.kind, frames: r.frames,
			wall_ms_p50: + w.p50.toFixed( 2 ), wall_ms_p95: + w.p95.toFixed( 2 ), wall_ms_max: + w.max.toFixed( 2 ), fps_equiv: w.mean > 0 ? + ( 1000 / w.mean ).toFixed( 2 ) : 0,
			cpu_ms_p50: + c.p50.toFixed( 2 ), gpu_ms_p50: r.gpu.length ? + g.p50.toFixed( 2 ) : null, gpu_ms_p95: r.gpu.length ? + g.p95.toFixed( 2 ) : null,
			draw_calls: Math.round( r.draws / r.frames ), triangles: Math.round( r.tris / r.frames ) };
	} );
	const W = fin( all.wall ), C = fin( all.cpu ), G = fin( all.gpu );
	if ( wasPlaying && engine.play ) engine.play();
	const cv = renderer.domElement, size = cv ? { x: cv.width, y: cv.height } : null; // drawing-buffer pixels (render scale applied)
	return {
		dt, frames, wall_s: + ( ( NOW() - wallStart ) / 1000 ).toFixed( 2 ), backend: prof.backend, renderScale: engine.renderScale || 1,
		size: size ? [ size.x, size.y ] : null, preset: engine.presetName || '',
		total: { wall_ms_p50: + W.p50.toFixed( 2 ), wall_ms_p95: + W.p95.toFixed( 2 ), wall_ms_max: + W.max.toFixed( 2 ), fps_equiv: W.mean > 0 ? + ( 1000 / W.mean ).toFixed( 2 ) : 0,
			cpu_ms_p50: + C.p50.toFixed( 2 ), cpu_ms_p95: + C.p95.toFixed( 2 ), gpu_ms_p50: all.gpu.length ? + G.p50.toFixed( 2 ) : null, gpu_ms_p95: all.gpu.length ? + G.p95.toFixed( 2 ) : null },
		rows: out,
	};
}

/** Format a bench result as a fixed-width text table (for logs and the HUD). */
export function formatBench( res ) {
	const pad = ( s, n ) => String( s ).padEnd( n ), lp = ( s, n ) => String( s ).padStart( n );
	const head = pad( 'shot', 40 ) + lp( 'frames', 7 ) + lp( 'p50 ms', 9 ) + lp( 'p95 ms', 9 ) + lp( 'fps', 7 ) + lp( 'gpu p50', 9 ) + lp( 'draws', 7 ) + lp( 'tris', 9 );
	const lines = [ head, '-'.repeat( head.length ) ];
	for ( const r of res.rows ) lines.push( pad( r.shot.slice( 0, 39 ), 40 ) + lp( r.frames, 7 ) + lp( r.wall_ms_p50, 9 ) + lp( r.wall_ms_p95, 9 ) + lp( r.fps_equiv, 7 ) + lp( r.gpu_ms_p50 ?? '-', 9 ) + lp( r.draw_calls, 7 ) + lp( r.triangles, 9 ) );
	lines.push( '-'.repeat( head.length ) );
	const t = res.total;
	lines.push( pad( 'TOTAL', 40 ) + lp( res.frames, 7 ) + lp( t.wall_ms_p50, 9 ) + lp( t.wall_ms_p95, 9 ) + lp( t.fps_equiv, 7 ) + lp( t.gpu_ms_p50 ?? '-', 9 ) );
	return lines.join( '\n' );
}

export default { Profiler, bench, formatBench, describeBackend, gpuIdle };
