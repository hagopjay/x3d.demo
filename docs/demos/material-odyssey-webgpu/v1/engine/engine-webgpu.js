// engine-webgpu.js - the cinema engine for A Material Odyssey (three.js 0.186.1 WebGPURenderer)
//
// Performs the SAME odyssey.x3d that X_ITE plays natively: x3d-loader.js builds the scene graph and
// evaluates TimeSensor 'Film' + interpolators + ROUTEs (the director's camera lives in the X3D file).
// On top of the X3D image this engine adds what X3D 4.0 cannot say:
//   - PMREM studio/gold environment reflections (intensity follows the film's own light level, so the
//     black overture stays black)
//   - shadows on key lights only (X3D shadows='true' lights plus a short priority list), shadow maps
//     re-rendered only while the light is on
//   - volumetric light shafts: analytic in-scattering through the 4 most visible SpotLight cones
//     (X3D spot cone + inverse-square/radius model, Henyey-Greenstein phase), raymarched against the
//     depth buffer with interleaved-gradient jitter resolved by TRAA (GodraysNode supports only point and
//     directional lights with a full shadow setup; this film is lit by SpotLights)
//   - GPU compute dust: 262,144 motes (WebGPU) / 32,768 (WebGL2) in a camera-centred wrap-around box,
//     curl-like noise drift plus the drone's prop wash, lit per mote by the same spot cones + DroneLamp
//   - TRAA (or SMAA / MSAA), thresholded bloom, per-shot depth of field from film.json focus_m /
//     aperture / lens_mm, chromatic aberration ramped by camera speed, film grain, vignette,
//     2.39:1 letterbox, fade through black at the chapter cards, AgX / ACES / X_ITE-neutral tone mapping
//   - FPV buffeting: a deterministic sub-degree shake only inside FPV shots, zero in the held frames
//   - adaptive render-scale governor (60 fps target, 30 fps on software adapters), presets
//     low / high / ultra / parity, forceWebGL fallback, zero per-frame allocations in our code.
//
// Usage:
//   import { createEngine } from './engine/engine-webgpu.js';
//   const eng = await createEngine( { container, x3d: 'odyssey.x3d', film: 'film.json', preset: 'high' } );
//   eng.start();   // or eng.renderAt( t ) for deterministic frames
//   eng.on( 'card', ( card ) => ... );  eng.seek( 60 );  eng.setPreset( 'ultra' );  eng.profiler.hudText();

import * as THREE from 'three/webgpu';
import {
	Fn, float, int, vec2, vec3, vec4, uniform, uniformArray, pass, mrt, output, velocity, uv, screenSize,
	mix, smoothstep, clamp, max, min, pow, exp, sqrt, length, normalize, dot, abs, mod, Loop, If, select,
	interleavedGradientNoise, screenCoordinate, hash, instancedArray, instanceIndex, mx_noise_vec3, luminance,
	agxToneMapping, acesFilmicToneMapping, sRGBTransferOETF, convertToTexture, positionLocal,
} from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { load, registerX3DLights, neutralToneMap, x3dGlobals } from './x3d-loader.js';
import { Profiler, describeBackend, bench as runBench, formatBench } from './profiler.js';

export const ENGINE_VERSION = '1.0.0';

// Chromium 141 rejects three 0.186.1's GPUTextureViewDescriptor.swizzle = 'rgba' (a string; Chrome 141 expects a
// GPUTextureComponentSwizzle dictionary). The identity swizzle is dropped for the call and restored: no allocation.
if ( typeof globalThis !== 'undefined' && globalThis.GPUTexture && ! globalThis.GPUTexture.prototype.__odysseySwizzleShim ) {
	const createView = globalThis.GPUTexture.prototype.createView;
	globalThis.GPUTexture.prototype.createView = function ( d ) {
		if ( d && d.swizzle === 'rgba' ) { d.swizzle = undefined; try { return createView.call( this, d ); } finally { d.swizzle = 'rgba'; } }
		return createView.call( this, d );
	};
	globalThis.GPUTexture.prototype.__odysseySwizzleShim = true;
}

// ---------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------
const BASE = {
	post: true, toneMapping: 'x3d', exposure: 1, lightMode: 'cull', mipFilter: 'linear', anisotropy: 8,
	aa: 'traa', msaa: 0, bloom: true, bloomStrength: 0.7, bloomRadius: 0.55, bloomThreshold: 0.85,
	dof: true, bokehScale: 2.0, shafts: true, shaftSteps: 16, shaftDensity: 0.006, shaftLights: 4,
	dust: 131072, dustGL: 32768, dustBox: 18, dustSize: 0.0028, dustGain: 9,
	env: true, envMax: 0.42, shadows: 2, shadowMapSize: 1024,
	grain: 0.022, vignette: 0.28, ca: 0.0018, caSpeed: 0.0055, letterbox: true, fades: true, shake: true,
	unlitGain: 1.0, emissiveGain: 1.0, dprCap: 1.5, maxScale: 1, minScale: 0.55,
};
export const PRESETS = {
	low: { ...BASE, aa: 'smaa', dof: false, bloomStrength: 0.55, shaftSteps: 6, shaftLights: 2, dust: 65536, dustGL: 16384, shadows: 0, anisotropy: 4, dprCap: 1, maxScale: 0.85, minScale: 0.5 },
	high: { ...BASE },
	ultra: { ...BASE, bloomStrength: 0.8, shaftSteps: 28, shaftLights: 4, dust: 262144, dustGL: 32768, shadows: 5, shadowMapSize: 2048, anisotropy: 16, bokehScale: 2.5, dprCap: 2, minScale: 0.6 },
	// X_ITE 16.4.3 parity: post FX off, X3D light order, X_ITE's texture filter, X_ITE's neutral tone map + gamma 2.2
	parity: { ...BASE, post: false, lightMode: 'x3d', mipFilter: 'nearest', anisotropy: 1, aa: 'msaa', msaa: 4, bloom: false, dof: false, shafts: false,
		dust: 0, dustGL: 0, env: false, shadows: 0, grain: 0, vignette: 0, ca: 0, caSpeed: 0, letterbox: false, fades: false, shake: false, dprCap: 1, maxScale: 1, minScale: 1 },
};
// key lights that may cast shadows (in priority order) beyond the ones the X3D file marks shadows='true'
const SHADOW_PRIORITY = [ 'Key', 'DaisPool', 'EdgeL', 'EdgeR', 'Rim', 'WashL', 'WashR' ];

// ---------------------------------------------------------------------------------------------
// Small TSL helpers
// ---------------------------------------------------------------------------------------------
/** X3D/X_ITE PhysicalMaterial spot model at a world point (no shadows): returns light colour * intensity * falloff. */
const spotAt = /*@__PURE__*/ Fn( ( [ x, lpos, ldir, lcol ] ) => {
	const L = lpos.xyz.sub( x );
	const d2 = max( dot( L, L ), 1e-4 );
	const d = sqrt( d2 );
	const l = L.div( d );
	const cosA = dot( l.negate(), ldir.xyz );
	const t = clamp( cosA.sub( ldir.w ).div( max( lcol.w.sub( ldir.w ), 1e-4 ) ), 0, 1 );
	const r = d.div( lpos.w );
	const range = clamp( float( 1 ).sub( r.mul( r ).mul( r ).mul( r ) ), 0, 1 );
	return lcol.xyz.mul( t.mul( t ).mul( range ).div( max( d2, 0.09 ) ) );
} );

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler( 0, 0, 0, 'YXZ' );
const _size = new THREE.Vector2();

export class OdysseyEngine {
	constructor( opts = {} ) {
		this.opts = opts;
		this.presetName = opts.preset && PRESETS[ opts.preset ] ? opts.preset : 'high';
		this.P = { ...PRESETS[ this.presetName ], ...( opts.overrides || {} ) };
		this.container = opts.container || null;
		this.canvas = opts.canvas || null;
		this.renderer = null; this.world = null; this.film = null; this.pipeline = null; this.profiler = null;
		this.time = 0; this.playing = false; this.rate = 1; this.loop = opts.loop !== false;
		this.renderScale = 1; this._baseDPR = 1;
		this._listeners = new Map();
		this._lastNow = 0; this._card = null; this._shot = - 1;
		this.timings = {};
		// uniforms shared by the post graph and the dust compute (values mutated in place every frame)
		this.u = {
			camPos: uniform( new THREE.Vector3() ), camWorld: uniform( new THREE.Matrix4() ), tanHalf: uniform( new THREE.Vector2( 1, 1 ) ),
			camVel: uniform( new THREE.Vector3() ), speed: uniform( 0 ), dt: uniform( 1 / 60 ), time: uniform( 0 ), frame: uniform( 0 ),
			focus: uniform( 10 ), focalRange: uniform( 20 ), bokeh: uniform( 1 ), fade: uniform( 1 ), exposure: uniform( 1 ),
			ca: uniform( 0 ), grain: uniform( 0 ), vignette: uniform( 0 ), shaftDensity: uniform( 0 ), dustGain: uniform( 1 ),
			lightCount: uniform( 0, 'int' ), dronePos: uniform( new THREE.Vector3() ), droneCol: uniform( new THREE.Vector3() ), droneRadius: uniform( 4 ),
			dustBox: uniform( 18 ), dustSize: uniform( 0.004 ), aspect: uniform( 16 / 9 ),
		};
		const K = 4;
		this._lp = []; this._ld = []; this._lc = [];
		for ( let i = 0; i < K; i ++ ) { this._lp.push( new THREE.Vector4( 0, 0, 0, 1 ) ); this._ld.push( new THREE.Vector4( 0, - 1, 0, 0.9 ) ); this._lc.push( new THREE.Vector4( 0, 0, 0, 0.95 ) ); }
		this.u.lPos = uniformArray( this._lp, 'vec4' ); this.u.lDir = uniformArray( this._ld, 'vec4' ); this.u.lCol = uniformArray( this._lc, 'vec4' );
		this._cand = new Float64Array( 64 ); this._candIdx = new Int32Array( 64 );
	}

	on( ev, fn ) { if ( ! this._listeners.has( ev ) ) this._listeners.set( ev, [] ); this._listeners.get( ev ).push( fn ); return this; }
	_emit( ev, a ) { const l = this._listeners.get( ev ); if ( l ) for ( let i = 0; i < l.length; i ++ ) l[ i ]( a, this ); }

	// ----- setup ----------------------------------------------------------------------------
	async init() {
		const T = ( k, t0 ) => { this.timings[ k ] = + ( performance.now() - t0 ).toFixed( 1 ); };
		let t0 = performance.now();
		const P = this.P, opts = this.opts;
		if ( ! this.canvas ) { this.canvas = document.createElement( 'canvas' ); if ( this.container ) this.container.appendChild( this.canvas ); }
		this.canvas.style.display = 'block';
		if ( this.container ) { this.canvas.style.position = 'absolute'; this.container.style.background = this.container.style.background || '#000'; }
		const forceWebGL = !! opts.forceWebGL || ( typeof navigator !== 'undefined' && ! navigator.gpu );
		this.renderer = new THREE.WebGPURenderer( { canvas: this.canvas, antialias: false, alpha: false, trackTimestamp: opts.trackTimestamp !== false,
			forceWebGL, reversedDepthBuffer: opts.reversedDepth !== false, powerPreference: 'high-performance' } );
		await this.renderer.init();
		registerX3DLights( this.renderer );
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.backend = describeBackend( this.renderer );
		this.isWebGPU = this.backend.backend === 'WebGPU';
		this.targetFps = opts.targetFps || ( this.backend.software ? 30 : 60 );
		this.profiler = new Profiler( this.renderer, { window: 240 } );
		T( 'renderer', t0 );

		// the film (X3D) and its sidecar
		t0 = performance.now();
		this.world = await load( opts.x3d || 'odyssey.x3d', { renderer: this.renderer, lightMode: P.lightMode, anisotropy: P.anisotropy, mipFilter: P.mipFilter,
			shadowMapSize: P.shadowMapSize, onProgress: opts.onProgress } );
		T( 'load', t0 );
		this.film = typeof opts.film === 'object' && opts.film ? opts.film : await ( await fetch( opts.film || 'film.json' ) ).json();
		this.duration = this.world.film && this.world.film.length ? this.world.film.length : ( this.film.length_s || 0 );
		this.world.film.playing = false;
		this.scene = this.world.scene; this.camera = this.world.camera;
		x3dGlobals.unlitGain.value = P.unlitGain; x3dGlobals.emissiveGain.value = P.emissiveGain;

		t0 = performance.now();
		this._prepareFilmTables();
		T( 'film_tables', t0 );
		t0 = performance.now();
		this._setupShadows();
		if ( P.env ) this._setupEnvironment();
		T( 'environment', t0 );
		t0 = performance.now();
		this._setupDust();
		T( 'dust', t0 );
		this._buildPipeline();
		this.resize();
		if ( typeof window !== 'undefined' && opts.autoResize !== false ) { this._onResize = () => this.resize(); window.addEventListener( 'resize', this._onResize ); }
		// compile every material variant up front (also the ones hidden at t=0), so nothing compiles mid-film
		t0 = performance.now();
		await this._compileAll();
		T( 'compile', t0 );
		this.seek( opts.startTime || 0 );
		return this;
	}

	_prepareFilmTables() {
		const film = this.film, L = this.duration;
		// camera speed table at 30 Hz from the CamPos interpolator (central differences, deterministic for scrubbing)
		const cp = this.world.getNode( 'CamPos' );
		const n = Math.max( 2, Math.ceil( L * 30 ) + 1 );
		this._speed = new Float32Array( n ); this._vel = new Float32Array( n * 3 );
		if ( cp && cp.f.key.length > 1 ) {
			const key = cp.f.key, kv = cp.f.keyValue, cnt = Math.min( key.length, kv.length / 3 | 0 );
			const pos = ( t, out ) => { const f = Math.min( Math.max( t / L, 0 ), 1 ); let lo = 0, hi = cnt - 1; if ( f <= key[ 0 ] ) return out.set( kv[ 0 ], kv[ 1 ], kv[ 2 ] ); if ( f >= key[ cnt - 1 ] ) return out.set( kv[ hi * 3 ], kv[ hi * 3 + 1 ], kv[ hi * 3 + 2 ] );
				while ( hi - lo > 1 ) { const m = ( lo + hi ) >> 1; if ( key[ m ] <= f ) lo = m; else hi = m; } const s = ( f - key[ lo ] ) / ( key[ hi ] - key[ lo ] || 1 );
				return out.set( kv[ lo * 3 ] + ( kv[ hi * 3 ] - kv[ lo * 3 ] ) * s, kv[ lo * 3 + 1 ] + ( kv[ hi * 3 + 1 ] - kv[ lo * 3 + 1 ] ) * s, kv[ lo * 3 + 2 ] + ( kv[ hi * 3 + 2 ] - kv[ lo * 3 + 2 ] ) * s ); };
			const h = 1 / 30;
			for ( let i = 0; i < n; i ++ ) {
				const t = i / 30; pos( t + h, _v ); pos( t - h, _v2 ); _v.sub( _v2 ).multiplyScalar( 1 / ( 2 * h ) );
				this._vel[ i * 3 ] = _v.x; this._vel[ i * 3 + 1 ] = _v.y; this._vel[ i * 3 + 2 ] = _v.z; this._speed[ i ] = _v.length();
			}
			// light smoothing (5 taps) so cuts in velocity do not flash the aberration
			const s = Float32Array.from( this._speed );
			for ( let i = 2; i < n - 2; i ++ ) this._speed[ i ] = ( s[ i - 2 ] + s[ i - 1 ] + s[ i ] + s[ i + 1 ] + s[ i + 2 ] ) / 5;
		}
		this.stats = { speed_max_mps: + Math.max( ...this._speed ).toFixed( 2 ) };
		// shots with DOF parameters: focus distance (m), blur range (m) from thin-lens depth of field, bokeh scale from f/N
		// shots with depth-of-field parameters: focus distance S (m) and f-number N from film.json; the focal length is taken
		// from the camera's live fieldOfView every frame (lens creep changes it), see _step()
		this._shots = ( film.shots || [] ).map( ( s ) => ( { t0: s.t0, t1: s.t1, name: s.name, kind: s.kind || '', focus: s.focus_m || 10, N: s.aperture || 8, lens_mm: s.lens_mm || 35 } ) );
		// title cards -> fades (chapter cards fade 0.4 s each side; the opening cards are hard cuts on black)
		this._cards = ( film.title_cards || [] ).map( ( c ) => ( { ...c, fade: /fades to black/.test( c.style || '' ) ? 0.4 : 0 } ) );
		// the film's own light level (for environment intensity): sample at 1 Hz, normalise by the 85th percentile
		// tabulated at 10 Hz once here (about 1,400 setTime calls, ~0.1 s), so the frame loop does a table lookup instead
		const nL = Math.ceil( L * 10 ) + 1, levels = new Float64Array( nL );
		for ( let i = 0; i < nL; i ++ ) { this.world.setTime( i / 10 ); levels[ i ] = this._lightLevel(); }
		const sorted = levels.slice().sort();
		this._levelRef = sorted[ Math.floor( sorted.length * 0.85 ) ] || 1;
		for ( let i = 0; i < nL; i ++ ) levels[ i ] /= this._levelRef;
		this._levelTab = levels;
		this.world.setTime( 0 );
	}

	_lightLevel() {
		// a cached plain array of light objects (the records gain properties in different orders -> polymorphic loads),
		// locals for every read, and a typed-array accumulator: measured allocation-free after JIT warm-up
		const L = this._lightObjs || ( this._lightObjs = this.world.lightRecords.map( ( r ) => r.light ) ), acc = this._acc || ( this._acc = new Float64Array( 1 ) );
		acc[ 0 ] = 0;
		for ( let i = 0; i < L.length; i ++ ) {
			const l = L[ i ], k = l.intensity;
			if ( k > 0 ) { const c = l.color; acc[ 0 ] += k * ( 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b ); }
		}
		return acc[ 0 ];
	}

	_setupShadows() {
		const P = this.P;
		const recs = this.world.lightRecords;
		this._shadowLights = [];
		for ( const r of recs ) if ( r.light.castShadow ) this._shadowLights.push( r.light ); // X3D shadows='true'
		if ( P.shadows === 0 ) { for ( const l of this._shadowLights ) l.castShadow = false; this._shadowLights.length = 0; return; }
		for ( const def of SHADOW_PRIORITY ) {
			if ( this._shadowLights.length >= P.shadows ) break;
			const n = this.world.getNode( def );
			if ( ! n ) continue;
			for ( const l of n.instances ) {
				if ( l.castShadow || ! l.isLight || this._shadowLights.length >= P.shadows ) continue;
				l.castShadow = true;
				l.shadow.mapSize.set( P.shadowMapSize, P.shadowMapSize );
				l.shadow.bias = - 0.0004; l.shadow.normalBias = 0.02;
				if ( l.shadow.camera.isPerspectiveCamera ) { l.shadow.camera.near = 0.3; l.shadow.camera.far = Math.max( 2, l.x3d ? l.x3d.radius : 50 ); }
				this._shadowLights.push( l );
			}
		}
		for ( const l of this._shadowLights ) { l.shadow.mapSize.set( P.shadowMapSize, P.shadowMapSize ); l.shadow.autoUpdate = true; }
	}

	_setupEnvironment() {
		// "studio/gold": a warm near-black room, one large soft key above, two gold strip lights, a rim panel, a maroon floor bounce
		const env = new THREE.Scene();
		const room = new THREE.Mesh( new THREE.SphereGeometry( 10, 32, 16 ), new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide } ) );
		const y = normalize( positionLocal ).y;
		room.material.colorNode = mix( vec3( 0.010, 0.006, 0.004 ), vec3( 0.06, 0.045, 0.03 ), smoothstep( - 0.6, 0.9, y ) );
		env.add( room );
		const panel = ( w, h, color, x, yy, z, rx, ry ) => {
			const m = new THREE.Mesh( new THREE.PlaneGeometry( w, h ), new THREE.MeshBasicNodeMaterial( { side: THREE.DoubleSide } ) );
			m.material.colorNode = vec3( color[ 0 ], color[ 1 ], color[ 2 ] );
			m.position.set( x, yy, z ); m.rotation.set( rx, ry, 0 ); env.add( m );
		};
		panel( 6, 6, [ 7.0, 6.0, 4.6 ], 0, 8.5, 0, Math.PI / 2, 0 ); // soft key overhead
		panel( 0.6, 7, [ 5.2, 3.3, 1.1 ], - 8.5, 1.5, 0, 0, Math.PI / 2 ); // gold strips
		panel( 0.6, 7, [ 5.2, 3.3, 1.1 ], 8.5, 1.5, 0, 0, - Math.PI / 2 );
		panel( 5, 2.2, [ 2.4, 2.0, 1.6 ], 0, 3, - 9, 0, 0 ); // rim panel behind
		panel( 12, 3, [ 0.55, 0.06, 0.16 ], 0, - 6, 6, - Math.PI / 3, 0 ); // maroon bounce
		const pmrem = new THREE.PMREMGenerator( this.renderer );
		this._envRT = pmrem.fromScene( env, 0.035 );
		pmrem.dispose();
		env.traverse( ( o ) => { if ( o.geometry ) o.geometry.dispose(); if ( o.material ) o.material.dispose(); } );
		this.scene.environment = this._envRT.texture;
		this.scene.environmentIntensity = 0;
	}

	_setupDust() {
		const P = this.P;
		const N = this.isWebGPU ? P.dust : P.dustGL;
		this.dustCount = N;
		if ( this._dust ) { this.scene.remove( this._dust.sprite ); this._dust.sprite.material.dispose(); this._dust = null; }
		if ( ! N ) return;
		const u = this.u;
		const pos = instancedArray( N, 'vec4' ), vel = instancedArray( N, 'vec4' ), col = instancedArray( N, 'vec4' );
		const init = Fn( () => {
			const i = instanceIndex;
			const r = vec3( hash( i ), hash( i.add( 7919 ) ), hash( i.add( 104729 ) ) ).sub( 0.5 ).mul( u.dustBox );
			pos.element( i ).assign( vec4( u.camPos.add( r ), hash( i.add( 31337 ) ) ) );
			vel.element( i ).assign( vec4( 0 ) );
			col.element( i ).assign( vec4( 0 ) );
		} )().compute( N );
		const lights = this.u;
		const update = Fn( () => {
			const i = instanceIndex;
			const P4 = pos.element( i );
			const p = P4.xyz.toVar(), seed = P4.w;
			const v = vel.element( i ).xyz.toVar();
			// drift: smooth noise field (slow), slight settling; prop wash near the lens, along the camera velocity and outward
			const flow = mx_noise_vec3( p.mul( 0.33 ).add( vec3( 0, u.time.mul( 0.045 ), u.time.mul( 0.02 ) ) ) ).mul( 0.07 ).add( vec3( 0, - 0.004, 0 ) );
			const d = p.sub( u.camPos ), r = length( d );
			const wash = u.camVel.mul( 0.55 ).add( d.div( max( r, 1e-3 ) ).mul( u.speed.mul( 0.14 ).add( 0.05 ) ) ).mul( smoothstep( 2.6, 0.0, r ) );
			v.assign( mix( v, flow.add( wash ), clamp( u.dt.mul( 1.6 ), 0, 1 ) ) );
			p.addAssign( v.mul( u.dt ) );
			const half = u.dustBox.mul( 0.5 );
			const rel = mod( p.sub( u.camPos ).add( half ), u.dustBox ).sub( half ).toVar();
			p.assign( u.camPos.add( rel ) );
			// light it: the selected spot cones + the drone's own lamp (inverse square within its radius)
			const lit = vec3( 0 ).toVar();
			Loop( lights.lightCount, ( { i: k } ) => {
				lit.addAssign( spotAt( p, lights.lPos.element( k ), lights.lDir.element( k ), lights.lCol.element( k ) ) );
			} );
			const Ld = u.dronePos.sub( p ), dd2 = max( dot( Ld, Ld ), 0.04 ), dr = sqrt( dd2 ).div( u.droneRadius );
			lit.addAssign( u.droneCol.mul( clamp( float( 1 ).sub( dr.mul( dr ).mul( dr ).mul( dr ) ), 0, 1 ).div( dd2 ) ) );
			// fade at the box faces (no pops when wrapping) and right at the lens; twinkle per mote
			const m = max( abs( rel.x ), max( abs( rel.y ), abs( rel.z ) ) );
			const edge = smoothstep( half, half.mul( 0.72 ), m );
			const near = smoothstep( 0.06, 0.4, length( rel ) );
			const twinkle = float( 0.55 ).add( float( 0.45 ).mul( hash( seed.mul( 977.0 ).add( u.frame.mul( 0.0 ) ) ) ) );
			col.element( i ).assign( vec4( lit.mul( edge.mul( near ).mul( twinkle ).mul( u.dustGain ) ), seed ) );
			pos.element( i ).assign( vec4( p, seed ) );
			vel.element( i ).assign( vec4( v, 0 ) );
		} )().compute( N );
		const mat = new THREE.SpriteNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } );
		mat.positionNode = pos.toAttribute().xyz;
		const c = col.toAttribute();
		const q = uv().sub( 0.5 ).mul( 2 ), r2 = dot( q, q );
		const shape = clamp( float( 1 ).sub( r2 ), 0, 1 ).pow( 2 );
		mat.colorNode = vec4( c.xyz.mul( shape ), 1 );
		mat.opacityNode = shape;
		mat.scaleNode = u.dustSize.mul( float( 0.6 ).add( c.w.mul( 0.9 ) ) );
		const sprite = new THREE.Sprite( mat );
		sprite.count = N; sprite.frustumCulled = false; sprite.renderOrder = 10; sprite.name = 'Dust';
		sprite.castShadow = false; sprite.receiveShadow = false;
		this.scene.add( sprite );
		this._dust = { init, update, sprite, N, initialized: false };
	}

	_buildPipeline() {
		const P = this.P, u = this.u;
		if ( this.pipeline ) this.pipeline.dispose();
		const pipe = new THREE.RenderPipeline( this.renderer );
		pipe.outputColorTransform = false;
		const useTRAA = P.post && P.aa === 'traa';
		const scenePass = pass( this.scene, this.camera, { samples: P.aa === 'msaa' ? ( P.msaa || 4 ) : 0 } );
		if ( useTRAA ) scenePass.setMRT( mrt( { output, velocity } ) );
		const color = scenePass.getTextureNode( 'output' );
		this.scenePass = scenePass;
		if ( ! P.post ) {
			// X_ITE parity output: pow( neutral( L ), 1/2.2 )
			pipe.outputNode = vec4( pow( neutralToneMap( color.rgb.max( vec3( 0 ) ) ), vec3( 1 / 2.2 ) ), 1 );
			this.pipeline = pipe; return;
		}
		const viewZ = scenePass.getViewZNode();
		const depthTex = scenePass.getTextureNode( 'depth' );
		// --- volumetric shafts (analytic spot-cone in-scattering), added in HDR before anti-aliasing
		let hdr = color;
		if ( P.shafts ) {
			const steps = Math.max( 2, P.shaftSteps | 0 );
			const shafts = Fn( () => {
				const st = uv();
				const ndc = vec2( st.x.mul( 2 ).sub( 1 ), st.y.oneMinus().mul( 2 ).sub( 1 ) );
				const z = viewZ.negate().min( 60.0 ); // metres along the view axis, marched up to 60 m
				const vpos = vec3( ndc.x.mul( u.tanHalf.x ), ndc.y.mul( u.tanHalf.y ), - 1 ).mul( z );
				const wpos = u.camWorld.mul( vec4( vpos, 1 ) ).xyz;
				const ray = wpos.sub( u.camPos );
				const dist = length( ray );
				const rd = ray.div( max( dist, 1e-4 ) );
				const stepLen = dist.div( steps );
				const jitter = interleavedGradientNoise( screenCoordinate.xy.add( u.frame.mod( 64 ).mul( 7.0 ) ) );
				const acc = vec3( 0 ).toVar();
				Loop( steps, ( { i } ) => {
					const x = u.camPos.add( rd.mul( float( i ).add( jitter ).mul( stepLen ) ) );
					Loop( u.lightCount, ( { i: k } ) => {
						const lp = u.lPos.element( k );
						const li = spotAt( x, lp, u.lDir.element( k ), u.lCol.element( k ) );
						// Henyey-Greenstein, g = 0.35: forward scattering toward the lens
						const l = normalize( lp.xyz.sub( x ) );
						const cosT = dot( l, rd );
						const g = 0.35, den = float( 1 + g * g ).sub( cosT.mul( 2 * g ) );
						const phase = float( ( 1 - g * g ) / ( 4 * Math.PI ) ).div( den.mul( sqrt( den ) ) );
						acc.addAssign( li.mul( phase ) );
					} );
				} );
				return acc.mul( stepLen ).mul( u.shaftDensity );
			} )();
			hdr = vec4( color.rgb.add( shafts ), color.a );
		}
		// --- anti-aliasing (temporal) on HDR
		let aa;
		if ( useTRAA ) { this.traaNode = traa( hdr, depthTex, scenePass.getTextureNode( 'velocity' ), this.camera ); aa = this.traaNode.getTextureNode(); }
		else aa = hdr === color ? color : convertToTexture( hdr );
		// --- chromatic aberration: radial, ramps with camera speed (3 taps of the resolved image)
		let c;
		if ( P.ca > 0 || P.caSpeed > 0 ) {
			const st = uv(), dir = st.sub( 0.5 ), amt = u.ca.mul( length( dir ).mul( 2 ) );
			const off = dir.mul( amt );
			c = vec3( aa.sample( st.add( off ) ).r, aa.sample( st ).g, aa.sample( st.sub( off ) ).b );
		} else c = aa.rgb;
		// --- depth of field per shot (film.json focus_m, aperture, lens_mm)
		let img = vec4( c, 1 );
		if ( P.dof ) img = dof( img, viewZ, u.focus, u.focalRange, u.bokeh );
		// --- bloom
		let lin = img.rgb;
		if ( P.bloom ) {
			const b = bloom( img, P.bloomStrength, P.bloomRadius, P.bloomThreshold );
			this.bloomNode = b;
			lin = lin.add( b.rgb );
		}
		// --- tone mapping (exposure), then display-space finishing
		const ex = lin.mul( u.exposure ).max( vec3( 0 ) );
		let disp;
		if ( P.toneMapping === 'agx' ) disp = sRGBTransferOETF( agxToneMapping( ex, float( 1 ) ) );
		else if ( P.toneMapping === 'aces' ) disp = sRGBTransferOETF( acesFilmicToneMapping( ex, float( 1 ) ) );
		else disp = pow( neutralToneMap( ex ), vec3( 1 / 2.2 ) ); // 'x3d': exactly X_ITE 16.4.3 KHR_PBR_NEUTRAL + gamma 2.2
		const st = uv();
		const vd = st.sub( 0.5 ).mul( vec2( u.aspect, 1 ) );
		const vig = mix( float( 1 ), smoothstep( 1.05, 0.2, length( vd ).mul( 1.25 ) ), u.vignette );
		const lum = luminance( disp );
		const n = hash( screenCoordinate.x.add( screenCoordinate.y.mul( 4099.0 ) ).add( u.frame.mod( 1024 ).mul( 7919.0 ) ) ).sub( 0.5 );
		const grain = n.mul( u.grain ).mul( sqrt( clamp( lum, 0, 1 ) ) ).mul( 2 );
		let out = vec4( disp.mul( vig ).add( grain ).mul( u.fade ).clamp( 0, 1 ), 1 );
		if ( P.aa === 'smaa' ) out = smaa( out );
		pipe.outputNode = out;
		this.pipeline = pipe;
	}

	async _compileAll() {
		const hidden = [];
		this.scene.traverse( ( o ) => { if ( ! o.visible ) { hidden.push( o ); o.visible = true; } } );
		const t0 = performance.now();
		try {
			if ( this._dust && this.isWebGPU !== undefined ) { await this.renderer.computeAsync( this._dust.init ); this._dust.initialized = true; }
			await this.scenePass.compileAsync( this.renderer );
		} catch ( e ) { console.warn( 'precompile failed (falls back to lazy compile):', e ); }
		this.timings.compile_scene = + ( performance.now() - t0 ).toFixed( 1 );
		for ( const o of hidden ) o.visible = false;
	}

	// ----- sizing / governor ------------------------------------------------------------------
	resize( w, h ) {
		const el = this.container;
		const W = w || ( el ? el.clientWidth : window.innerWidth ), H = h || ( el ? el.clientHeight : window.innerHeight );
		let bw = W, bh = H;
		if ( this.P.letterbox ) { const A = 2.39; if ( W / H < A ) bh = Math.round( W / A ); else bw = Math.round( H * A ); }
		this._cssW = bw; this._cssH = bh;
		this.canvas.style.left = ( ( W - bw ) / 2 ) + 'px'; this.canvas.style.top = ( ( H - bh ) / 2 ) + 'px';
		const dpr = Math.min( typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, this.P.dprCap );
		this._baseDPR = dpr;
		this.renderScale = Math.min( this.renderScale, this.P.maxScale );
		this.renderer.setPixelRatio( dpr * this.renderScale );
		this.renderer.setSize( bw, bh );
		this.world.setAspect( bw / bh );
		this.u.aspect.value = bw / bh;
		if ( this.profiler ) this.profiler.renderScale = this.renderScale;
	}
	setRenderScale( s ) {
		s = Math.min( Math.max( s, this.P.minScale ), this.P.maxScale );
		if ( Math.abs( s - this.renderScale ) < 0.01 ) return;
		this.renderScale = s;
		this.renderer.setPixelRatio( this._baseDPR * s );
		this.profiler.renderScale = s;
		this._emit( 'scale', s );
	}
	_govern( now ) {
		if ( this.opts.governor === false ) return;
		if ( ! this._govT ) { this._govT = now; return; }
		if ( now - this._govT < 750 ) return;
		this._govT = now;
		const st = this.profiler.interval;
		if ( st.count < 20 ) return;
		const s = this.profiler.stats().interval; // HUD-rate computation
		const budget = 1000 / this.targetFps;
		if ( s.p50 > budget * 1.12 ) { this.setRenderScale( this.renderScale * Math.max( 0.75, budget / s.p50 ) ); this.profiler.interval.clear(); this._upCredit = 0; }
		else if ( s.p95 < budget * 0.8 ) { this._upCredit = ( this._upCredit || 0 ) + 1; if ( this._upCredit >= 3 ) { this.setRenderScale( this.renderScale * 1.08 ); this._upCredit = 0; this.profiler.interval.clear(); } }
		else this._upCredit = 0;
	}

	// ----- playback ---------------------------------------------------------------------------
	play() { this.playing = true; this._lastNow = 0; this._emit( 'play' ); }
	pause() { this.playing = false; this._emit( 'pause' ); }
	seek( t ) { this.time = Math.min( Math.max( t, 0 ), this.duration ); this._step( this.time, 0 ); this._emit( 'seek', this.time ); }
	setRate( r ) { this.rate = r; }
	start() { this.play(); this.renderer.setAnimationLoop( this._loop || ( this._loop = ( now ) => this.frame( now ) ) ); }
	stop() { this.renderer.setAnimationLoop( null ); this.pause(); }

	/** One display frame (animation loop). */
	frame( now ) {
		const prof = this.profiler;
		prof.begin();
		let dt = this._lastNow ? ( now - this._lastNow ) / 1000 : 1 / 60;
		this._lastNow = now;
		if ( dt > 0.1 ) dt = 0.1; else if ( dt < 0 ) dt = 0;
		if ( this.playing ) {
			let t = this.time + dt * this.rate;
			if ( t >= this.duration ) { if ( this.loop ) { t -= this.duration; this._emit( 'loop' ); } else { t = this.duration; this.pause(); this._emit( 'end' ); } }
			this.time = t;
		}
		this._step( this.time, dt );
		if ( this._dust ) this.renderer.compute( this._dust.update );
		this.pipeline.render();
		prof.end();
		this._govern( now );
	}

	/** Deterministic frame at film time t (bench, screenshots). dt drives the dust only. */
	renderAt( t, dt = 1 / 30 ) {
		// outside setAnimationLoop three does not advance its NodeFrame; FRAME-scoped nodes (TRAA history, velocity,
		// bloom, DOF) update once per frameId, so advance it exactly like the renderer's animation loop does
		const nodes = this.renderer._nodes;
		if ( nodes && nodes.nodeFrame ) { nodes.nodeFrame.update(); this.renderer.info.frame = nodes.nodeFrame.frameId; }
		if ( this.renderer.info.autoReset ) this.renderer.info.reset();
		this.time = Math.min( Math.max( t, 0 ), this.duration );
		this._step( this.time, dt );
		if ( this._dust ) this.renderer.compute( this._dust.update );
		this.pipeline.render();
	}

	// ----- per-frame effect state (zero allocations) --------------------------------------------
	_step( t, dt ) {
		const P = this.P, u = this.u, w = this.world, cam = this.camera;
		w.setTime( t );
		// free-fly ("take the sticks"): the page may override the director's camera after the film has set it.
		// cameraHook( camera, t, dt ) returns true while it owns the camera; shake and per-shot DOF then stand down.
		const free = this.cameraHook ? this.cameraHook( cam, t, dt ) === true : false;
		u.time.value = t; u.dt.value = dt > 0 ? dt : 1 / 60; u.frame.value = ( u.frame.value + 1 ) % 1e6;
		// shot / card bookkeeping
		const si = this.shotIndexAt( t );
		if ( si !== this._shot ) { this._shot = si; this._emit( 'shot', this._shots[ si ] || null ); }
		const card = this.cardAt( t );
		if ( card !== this._card ) { this._card = card; this._emit( 'card', card ); }
		// FPV buffeting (deterministic in t; only inside FPV shots, faded over 0.6 s at the shot edges)
		const speed = free ? ( this.freeSpeed || 0 ) : this._sample( this._speed, t );
		if ( P.shake && si >= 0 && ! free ) {
			const sh = this._shots[ si ];
			if ( sh.kind === 'fpv' ) {
				const edge = Math.min( 1, ( t - sh.t0 ) / 0.6, ( sh.t1 - t ) / 0.6 );
				const a = Math.max( 0, edge ) * ( 0.25 + Math.min( speed / 20, 1 ) ) * ( Math.PI / 180 );
				const yaw = a * 0.32 * ( Math.sin( t * 7.31 ) * 0.6 + Math.sin( t * 13.7 + 1.3 ) * 0.3 + Math.sin( t * 41.0 + 0.7 ) * 0.1 );
				const pitch = a * 0.38 * ( Math.sin( t * 8.93 + 2.1 ) * 0.6 + Math.sin( t * 17.3 + 0.4 ) * 0.3 + Math.sin( t * 47.0 + 2.9 ) * 0.1 );
				const roll = a * 0.55 * ( Math.sin( t * 5.17 + 0.9 ) * 0.7 + Math.sin( t * 11.9 + 3.1 ) * 0.3 );
				_e.set( pitch, yaw, roll ); _q.setFromEuler( _e ); cam.quaternion.multiply( _q ); cam.updateMatrixWorld( true );
			}
		}
		// camera uniforms
		u.camPos.value.copy( cam.position );
		u.camWorld.value.copy( cam.matrixWorld );
		const pm = cam.projectionMatrix.elements;
		u.tanHalf.value.set( 1 / pm[ 0 ], 1 / pm[ 5 ] );
		const i30 = Math.min( this._speed.length - 1, Math.max( 0, Math.round( t * 30 ) ) );
		if ( free && this.freeVel ) u.camVel.value.copy( this.freeVel );
		else u.camVel.value.set( this._vel[ i30 * 3 ], this._vel[ i30 * 3 + 1 ], this._vel[ i30 * 3 + 2 ] );
		u.speed.value = speed;
		u.ca.value = P.ca + P.caSpeed * Math.min( speed / 30, 1.5 );
		u.grain.value = P.grain; u.vignette.value = P.vignette; u.dustGain.value = P.dustGain; u.dustBox.value = P.dustBox; u.dustSize.value = P.dustSize;
		u.shaftDensity.value = P.shafts ? P.shaftDensity : 0;
		// DOF: per-shot focus, cross-faded over +-0.6 s at shot boundaries (rack focus)
		if ( P.dof && si >= 0 ) {
			// thin lens on a 24 mm gate (the X3D fieldOfView convention of this film): f = 12 mm / tan(fov/2)
			const a = this._shots[ si ];
			let S = free ? ( this.freeFocus || 6 ) : a.focus, N = free ? 8 : a.N;
			const nb = this._shots[ si + 1 ], pb = this._shots[ si - 1 ];
			if ( free ) { /* no rack focus while the viewer flies */ }
			else if ( nb && t > a.t1 - 0.6 ) { const k = 0.5 * ( t - ( a.t1 - 0.6 ) ) / 0.6; S = Math.exp( Math.log( S ) * ( 1 - k ) + Math.log( nb.focus ) * k ); N = N * ( 1 - k ) + nb.N * k; } // rack focus
			else if ( pb && t < a.t0 + 0.6 ) { const k = 0.5 - 0.5 * ( t - a.t0 ) / 0.6; S = Math.exp( Math.log( S ) * ( 1 - k ) + Math.log( pb.focus ) * k ); N = N * ( 1 - k ) + pb.N * k; }
			const fovMin = Math.min( cam.fov, cam.fov * cam.aspect ) * Math.PI / 180; // smaller dimension
			const fmm = 12 / Math.tan( fovMin / 2 );
			const cInf = fmm * fmm / ( N * Math.max( S * 1000 - fmm, 1 ) ); // blur circle (mm on the gate) of a point at infinity
			this.renderer.getDrawingBufferSize( _size );
			const px = cInf / 24 * Math.min( _size.x, _size.y ); // in full-resolution pixels
			u.focus.value = S;
			u.focalRange.value = Math.max( 2 * S, 0.3 ); // CoC reaches 1 at 3S behind / 0 in front of the focus plane
			u.bokeh.value = Math.min( px * 0.5 * P.bokehScale, 24 ); // DOF node radius unit = half-resolution texel
			this.dofPx = px * P.bokehScale;
		}
		// fades at the chapter cards
		u.fade.value = P.fades ? this.fadeAt( t ) : 1;
		u.exposure.value = P.exposure;
		// environment follows the film's own light (0 in the black overture)
		if ( P.env && this._envRT ) {
			const lv = this._levelAt( t );
			const target = P.envMax * Math.min( 1, Math.pow( Math.max( lv, 0 ), 0.75 ) );
			if ( Math.abs( target - this.scene.environmentIntensity ) > 0.005 || ( target === 0 && this.scene.environmentIntensity !== 0 ) ) this.scene.environmentIntensity = target;
		}
		// shadow maps only while their light is on
		const sl = this._shadowLights;
		for ( let i = 0; i < sl.length; i ++ ) sl[ i ].shadow.autoUpdate = sl[ i ].intensity > 0;
		// the most visible spot cones -> shafts + dust lighting
		this._selectLights();
	}

	_selectLights() {
		const recs = this.world.lightRecords, P = this.P, u = this.u;
		const K = Math.min( P.shaftLights | 0, 4 );
		const cam = this.camera.position;
		let n = 0;
		const cand = this._cand, idx = this._candIdx;
		for ( let i = 0; i < recs.length && n < cand.length; i ++ ) {
			const l = recs[ i ].light;
			if ( l.isPointLight && recs[ i ].node.def === 'DroneLamp' ) continue;
			if ( ! l.isSpotLight || l.intensity <= 0 || ! l.visible ) continue;
			l.getWorldPosition( _v );
			// distance from the lens to the cone's axis segment (light -> light + dir * min(radius, 20))
			l.target.getWorldPosition( _v2 ); _v2.sub( _v ).normalize();
			const reach = Math.min( l.x3d ? l.x3d.radius * ( recs[ i ].worldScale || 1 ) : 20, 20 );
			const tt = Math.min( Math.max( ( cam.x - _v.x ) * _v2.x + ( cam.y - _v.y ) * _v2.y + ( cam.z - _v.z ) * _v2.z, 0 ), reach ); // projection of the lens on the axis
			const px = _v.x + _v2.x * tt - cam.x, py = _v.y + _v2.y * tt - cam.y, pz = _v.z + _v2.z * tt - cam.z;
			const d2 = px * px + py * py + pz * pz;
			const lum = 0.2126 * l.color.r + 0.7152 * l.color.g + 0.0722 * l.color.b;
			const cone = 1 - Math.cos( l.x3d ? l.x3d.cutOffAngle : l.angle ); // wider cones fill more air
			cand[ n ] = l.intensity * lum * ( 0.3 + cone ) / ( 1 + d2 / 25 );
			idx[ n ] = i; n ++;
		}
		// partial selection of the top K (no sort, no allocation)
		let count = 0;
		for ( let k = 0; k < K && k < n; k ++ ) {
			let best = - 1, bv = 0;
			for ( let j = 0; j < n; j ++ ) if ( cand[ j ] > bv ) { bv = cand[ j ]; best = j; }
			if ( best < 0 ) break;
			cand[ best ] = - 1;
			const rec = recs[ idx[ best ] ], l = rec.light;
			l.getWorldPosition( _v ); l.target.getWorldPosition( _v2 ); _v2.sub( _v ).normalize();
			const s = rec.worldScale || 1;
			const beam = l.x3d ? l.x3d.beamWidth : l.angle * ( 1 - l.penumbra ), cut = l.x3d ? l.x3d.cutOffAngle : l.angle;
			this._lp[ count ].set( _v.x, _v.y, _v.z, ( l.x3d ? l.x3d.radius : 100 ) * s );
			this._ld[ count ].set( _v2.x, _v2.y, _v2.z, Math.cos( cut ) );
			this._lc[ count ].set( l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, Math.cos( Math.min( beam, cut ) ) );
			count ++;
		}
		u.lightCount.value = count;
		// the drone's lamp (dust only)
		if ( this._droneLamp === undefined ) { const dn = this.world.getNode( 'DroneLamp' ); this._droneLamp = ( dn && dn.instances[ 0 ] ) || null; }
		const dl = this._droneLamp;
		if ( dl && dl.intensity > 0 ) { dl.getWorldPosition( u.dronePos.value ); u.droneCol.value.set( dl.color.r * dl.intensity, dl.color.g * dl.intensity, dl.color.b * dl.intensity ); u.droneRadius.value = dl.x3d ? dl.x3d.radius : 4; }
		else u.droneCol.value.set( 0, 0, 0 );
	}

	_levelAt( t ) { const a = this._levelTab, x = Math.min( Math.max( t * 10, 0 ), a.length - 1 ), i = Math.floor( x ), f = x - i; return i + 1 < a.length ? a[ i ] * ( 1 - f ) + a[ i + 1 ] * f : a[ i ]; }
	_sample( arr, t ) { const x = Math.min( Math.max( t * 30, 0 ), arr.length - 1 ), i = Math.floor( x ), f = x - i; return i + 1 < arr.length ? arr[ i ] * ( 1 - f ) + arr[ i + 1 ] * f : arr[ i ]; }

	// ----- film queries (no allocation; return references) ----------------------------------------
	shotIndexAt( t ) { const s = this._shots; for ( let i = 0; i < s.length; i ++ ) if ( t >= s[ i ].t0 && t < s[ i ].t1 ) return i; return s.length ? s.length - 1 : - 1; }
	shotAt( t = this.time ) { return this._shots[ this.shotIndexAt( t ) ] || null; }
	cardAt( t = this.time ) { const c = this._cards; for ( let i = 0; i < c.length; i ++ ) if ( t >= c[ i ].t0 && t < c[ i ].t1 ) return c[ i ]; return null; }
	chapterAt( t = this.time ) { const c = this.film.chapters || []; for ( let i = 0; i < c.length; i ++ ) if ( t >= c[ i ].t0 && t < c[ i ].t1 ) return c[ i ]; return null; }
	fadeAt( t ) {
		const c = this._cards;
		for ( let i = 0; i < c.length; i ++ ) {
			const k = c[ i ];
			if ( t < k.t0 || t >= k.t1 ) continue;
			if ( k.fade <= 0 ) return 0; // hard cut on black
			if ( t < k.t0 + k.fade ) return 1 - ( t - k.t0 ) / k.fade;
			if ( t > k.t1 - k.fade ) return ( t - ( k.t1 - k.fade ) ) / k.fade;
			return 0;
		}
		return 1;
	}

	// ----- presets / tools ------------------------------------------------------------------------
	async setPreset( name, overrides = {} ) {
		if ( ! PRESETS[ name ] ) throw new Error( 'unknown preset ' + name );
		const prev = this.P;
		this.presetName = name; this.P = { ...PRESETS[ name ], ...overrides };
		const P = this.P;
		x3dGlobals.unlitGain.value = P.unlitGain; x3dGlobals.emissiveGain.value = P.emissiveGain;
		if ( P.shadows !== prev.shadows || P.shadowMapSize !== prev.shadowMapSize ) {
			for ( const l of this._shadowLights ) { l.castShadow = false; }
			for ( const r of this.world.lightRecords ) if ( r.node.f.shadows ) r.light.castShadow = true;
			this._setupShadows();
		}
		if ( P.env && ! this._envRT ) this._setupEnvironment();
		if ( ! P.env ) this.scene.environmentIntensity = 0;
		if ( ( this.isWebGPU ? P.dust : P.dustGL ) !== this.dustCount ) this._setupDust();
		this._buildPipeline();
		this.renderScale = Math.min( this.renderScale, P.maxScale );
		this.resize();
		await this._compileAll();
		this._emit( 'preset', name );
	}
	bench( opts ) { return runBench( this, opts ); }
	formatBench( res ) { return formatBench( res ); }
	/** Static facts for the page / receipt. */
	describe() {
		const s = this.world.stats;
		return { engine: ENGINE_VERSION, three: THREE.REVISION, backend: this.backend, preset: this.presetName, targetFps: this.targetFps, dust: this.dustCount,
			shadowLights: this._shadowLights.map( ( l ) => l.name ), env: !! this._envRT, x3d: this.world.summary(), parse: { unsupported: s.unsupported, routes: s.routes, nodes_by_type: s.nodes_by_type },
			timings_ms: { ...this.timings, ...s.timings_ms }, camera_speed_max_mps: this.stats.speed_max_mps };
	}
	dispose() {
		this.stop();
		if ( this._onResize ) window.removeEventListener( 'resize', this._onResize );
		if ( this.pipeline ) this.pipeline.dispose();
		if ( this._envRT ) this._envRT.dispose();
		this.world.dispose();
		this.renderer.dispose();
	}
}

export async function createEngine( opts = {} ) {
	const e = new OdysseyEngine( opts );
	await e.init();
	return e;
}

export default { createEngine, OdysseyEngine, PRESETS, ENGINE_VERSION };
