// x3d-loader.js — X3D 4.0 (A Material Odyssey node contract) -> three.js 0.186.1 node materials.
// Works on both WebGPURenderer backends (WebGPU, and its WebGL2 fallback).
//
//   import { load } from './x3d-loader.js';
//   const world = await load('odyssey.x3d', { renderer });
//   world.scene / world.camera / world.film / world.setFraction(f) / world.update(dtSeconds) / world.stats
//
// Semantics follow ISO/IEC 19775-1:2023 (X3D 4.0). Where the standard leaves room, the loader follows
// X_ITE 16.4.3 (the reference engine of this film) so the two engines agree frame for frame:
//  - primitives are built from X_ITE's own tessellation (Box per-face UVs, 32x15 quad sphere with its seam
//    at -Z, 20-segment Cylinder/Cone with X_ITE cap UVs), IndexedFaceSet normals use X_ITE's crease rule
//    (unweighted unit face normals, dot > cos(creaseAngle));
//  - PhysicalMaterial lighting: glTF punctual model (inverse-square range window, squared cone falloff
//    between cos(cutOffAngle) and cos(beamWidth), attenuation 1/max(a0+a1 d+a2 d^2, 1)), gamma 2.2
//    texture decode, KHR PBR Neutral tone map, gamma 2.2 encode;
//  - UnlitMaterial / Background are display-referred in X_ITE (tone mapped, no gamma): the loader maps them
//    through the exact inverse of the engine output transform so they land on the same pixel values;
//  - at most 8 lights per shape in "x3d" light mode (X_ITE maxLights), in X_ITE order: global lights, then
//    scoped lights outermost group first. "cull" mode keeps the lights that can geometrically reach the shape.
//
// Zero allocations per frame in update(): every route, interpolator and field setter writes into
// preallocated typed arrays and three.js objects.

import * as THREE from 'three/webgpu';
import {
	uniform, texture as tslTexture, uv as tslUV, vec2, vec3, vec4, float, Fn, normalMap, lights as tslLights,
	select, max, min, mix, pow, sqrt, acos, clamp, dot, lightTargetDirection, renderGroup, positionWorldDirection
} from 'three/tsl';

export const LOADER_VERSION = '1.0.0';
const PI = Math.PI;

// ---------------------------------------------------------------------------------------------
// Field types and the node contract
// ---------------------------------------------------------------------------------------------
const SFBool = 1, SFInt32 = 2, SFFloat = 3, SFTime = 4, SFString = 5, SFVec2f = 6, SFVec3f = 7, SFRotation = 8,
	SFColor = 9, MFString = 10, MFFloat = 11, MFInt32 = 12, MFVec2f = 13, MFVec3f = 14, MFRotation = 15, MFColor = 16,
	SFNode = 17, MFNode = 18, SFVec4f = 19, SFColorRGBA = 20;

const LIGHT_FIELDS = {
	on: [ SFBool, true ], color: [ SFColor, [ 1, 1, 1 ] ], intensity: [ SFFloat, 1 ], ambientIntensity: [ SFFloat, 0 ],
	shadows: [ SFBool, false ], shadowIntensity: [ SFFloat, 1 ], metadata: [ SFNode, null ]
};
const GROUP_FIELDS = { children: [ MFNode, [] ], visible: [ SFBool, true ], bboxDisplay: [ SFBool, false ],
	bboxCenter: [ SFVec3f, [ 0, 0, 0 ] ], bboxSize: [ SFVec3f, [ - 1, - 1, - 1 ] ], metadata: [ SFNode, null ] };
const INTERP = ( valueType ) => ( { key: [ MFFloat, [] ], keyValue: [ valueType, [] ], metadata: [ SFNode, null ] } );

// containerField defaults (X3D 4.0 XML encoding)
const CF = { appearance: 'appearance', material: 'material', texture: 'texture', textureTransform: 'textureTransform',
	geometry: 'geometry', coord: 'coord', texCoord: 'texCoord', normal: 'normal', children: 'children', metadata: 'metadata' };

export const NODE_SPECS = {
	Scene: { cf: null, fields: { children: [ MFNode, [] ] } },
	WorldInfo: { cf: CF.children, fields: { title: [ SFString, '' ], info: [ MFString, [] ], metadata: [ SFNode, null ] } },
	NavigationInfo: { cf: CF.children, fields: { type: [ MFString, [ 'EXAMINE', 'ANY' ] ], headlight: [ SFBool, true ],
		avatarSize: [ MFFloat, [ 0.25, 1.6, 0.75 ] ], speed: [ SFFloat, 1 ], visibilityLimit: [ SFFloat, 0 ],
		transitionType: [ MFString, [ 'LINEAR' ] ], transitionTime: [ SFTime, 1 ], metadata: [ SFNode, null ] } },
	Background: { cf: CF.children, fields: { skyColor: [ MFColor, [ 0, 0, 0 ] ], skyAngle: [ MFFloat, [] ],
		groundColor: [ MFColor, [] ], groundAngle: [ MFFloat, [] ], transparency: [ SFFloat, 0 ], metadata: [ SFNode, null ] } },
	Viewpoint: { cf: CF.children, fields: { position: [ SFVec3f, [ 0, 0, 10 ] ], orientation: [ SFRotation, [ 0, 0, 1, 0 ] ],
		fieldOfView: [ SFFloat, PI / 4 ], centerOfRotation: [ SFVec3f, [ 0, 0, 0 ] ], description: [ SFString, '' ],
		jump: [ SFBool, true ], retainUserOffsets: [ SFBool, false ], nearDistance: [ SFFloat, - 1 ], farDistance: [ SFFloat, - 1 ],
		viewAll: [ SFBool, false ], navigationInfo: [ SFNode, null ], metadata: [ SFNode, null ] } },
	Transform: { cf: CF.children, fields: { ...GROUP_FIELDS, translation: [ SFVec3f, [ 0, 0, 0 ] ], rotation: [ SFRotation, [ 0, 0, 1, 0 ] ],
		scale: [ SFVec3f, [ 1, 1, 1 ] ], scaleOrientation: [ SFRotation, [ 0, 0, 1, 0 ] ], center: [ SFVec3f, [ 0, 0, 0 ] ] } },
	Group: { cf: CF.children, fields: { ...GROUP_FIELDS } },
	Switch: { cf: CF.children, fields: { ...GROUP_FIELDS, whichChoice: [ SFInt32, - 1 ] } },
	Shape: { cf: CF.children, fields: { appearance: [ SFNode, null ], geometry: [ SFNode, null ], castShadow: [ SFBool, true ],
		visible: [ SFBool, true ], bboxDisplay: [ SFBool, false ], bboxCenter: [ SFVec3f, [ 0, 0, 0 ] ], bboxSize: [ SFVec3f, [ - 1, - 1, - 1 ] ],
		metadata: [ SFNode, null ] } },
	Appearance: { cf: CF.appearance, fields: { material: [ SFNode, null ], texture: [ SFNode, null ], textureTransform: [ SFNode, null ],
		alphaMode: [ SFString, 'AUTO' ], alphaCutoff: [ SFFloat, 0.5 ], metadata: [ SFNode, null ] } },
	PhysicalMaterial: { cf: CF.material, fields: { baseColor: [ SFColor, [ 1, 1, 1 ] ], baseTexture: [ SFNode, null ], baseTextureMapping: [ SFString, '' ],
		emissiveColor: [ SFColor, [ 0, 0, 0 ] ], emissiveTexture: [ SFNode, null ], emissiveTextureMapping: [ SFString, '' ],
		metallic: [ SFFloat, 1 ], roughness: [ SFFloat, 1 ], metallicRoughnessTexture: [ SFNode, null ], metallicRoughnessTextureMapping: [ SFString, '' ],
		normalScale: [ SFFloat, 1 ], normalTexture: [ SFNode, null ], normalTextureMapping: [ SFString, '' ],
		occlusionStrength: [ SFFloat, 1 ], occlusionTexture: [ SFNode, null ], occlusionTextureMapping: [ SFString, '' ],
		transparency: [ SFFloat, 0 ], metadata: [ SFNode, null ] } },
	UnlitMaterial: { cf: CF.material, fields: { emissiveColor: [ SFColor, [ 1, 1, 1 ] ], emissiveTexture: [ SFNode, null ], emissiveTextureMapping: [ SFString, '' ],
		normalScale: [ SFFloat, 1 ], normalTexture: [ SFNode, null ], normalTextureMapping: [ SFString, '' ], transparency: [ SFFloat, 0 ], metadata: [ SFNode, null ] } },
	Material: { cf: CF.material, fields: { ambientIntensity: [ SFFloat, 0.2 ], diffuseColor: [ SFColor, [ 0.8, 0.8, 0.8 ] ], emissiveColor: [ SFColor, [ 0, 0, 0 ] ],
		shininess: [ SFFloat, 0.2 ], specularColor: [ SFColor, [ 0, 0, 0 ] ], transparency: [ SFFloat, 0 ],
		diffuseTexture: [ SFNode, null ], diffuseTextureMapping: [ SFString, '' ], emissiveTexture: [ SFNode, null ], emissiveTextureMapping: [ SFString, '' ],
		normalScale: [ SFFloat, 1 ], normalTexture: [ SFNode, null ], normalTextureMapping: [ SFString, '' ],
		ambientTexture: [ SFNode, null ], ambientTextureMapping: [ SFString, '' ], shininessTexture: [ SFNode, null ], shininessTextureMapping: [ SFString, '' ],
		specularTexture: [ SFNode, null ], specularTextureMapping: [ SFString, '' ], occlusionStrength: [ SFFloat, 1 ], occlusionTexture: [ SFNode, null ],
		occlusionTextureMapping: [ SFString, '' ], metadata: [ SFNode, null ] } },
	ImageTexture: { cf: CF.texture, fields: { url: [ MFString, [] ], repeatS: [ SFBool, true ], repeatT: [ SFBool, true ], textureProperties: [ SFNode, null ],
		description: [ SFString, '' ], metadata: [ SFNode, null ] } },
	TextureTransform: { cf: CF.textureTransform, fields: { translation: [ SFVec2f, [ 0, 0 ] ], rotation: [ SFFloat, 0 ], scale: [ SFVec2f, [ 1, 1 ] ],
		center: [ SFVec2f, [ 0, 0 ] ], mapping: [ SFString, '' ], metadata: [ SFNode, null ] } },
	Box: { cf: CF.geometry, fields: { size: [ SFVec3f, [ 2, 2, 2 ] ], solid: [ SFBool, true ], metadata: [ SFNode, null ] } },
	Sphere: { cf: CF.geometry, fields: { radius: [ SFFloat, 1 ], solid: [ SFBool, true ], metadata: [ SFNode, null ] } },
	Cylinder: { cf: CF.geometry, fields: { radius: [ SFFloat, 1 ], height: [ SFFloat, 2 ], top: [ SFBool, true ], side: [ SFBool, true ],
		bottom: [ SFBool, true ], solid: [ SFBool, true ], metadata: [ SFNode, null ] } },
	Cone: { cf: CF.geometry, fields: { bottomRadius: [ SFFloat, 1 ], height: [ SFFloat, 2 ], side: [ SFBool, true ], bottom: [ SFBool, true ],
		solid: [ SFBool, true ], metadata: [ SFNode, null ] } },
	IndexedFaceSet: { cf: CF.geometry, fields: { coord: [ SFNode, null ], texCoord: [ SFNode, null ], normal: [ SFNode, null ], color: [ SFNode, null ],
		coordIndex: [ MFInt32, [] ], texCoordIndex: [ MFInt32, [] ], normalIndex: [ MFInt32, [] ], colorIndex: [ MFInt32, [] ],
		creaseAngle: [ SFFloat, 0 ], solid: [ SFBool, true ], ccw: [ SFBool, true ], convex: [ SFBool, true ], normalPerVertex: [ SFBool, true ],
		colorPerVertex: [ SFBool, true ], metadata: [ SFNode, null ] } },
	IndexedTriangleSet: { cf: CF.geometry, fields: { coord: [ SFNode, null ], texCoord: [ SFNode, null ], normal: [ SFNode, null ], color: [ SFNode, null ],
		index: [ MFInt32, [] ], solid: [ SFBool, true ], ccw: [ SFBool, true ], normalPerVertex: [ SFBool, true ], colorPerVertex: [ SFBool, true ],
		metadata: [ SFNode, null ] } },
	Coordinate: { cf: CF.coord, fields: { point: [ MFVec3f, [] ], metadata: [ SFNode, null ] } },
	TextureCoordinate: { cf: CF.texCoord, fields: { point: [ MFVec2f, [] ], mapping: [ SFString, '' ], metadata: [ SFNode, null ] } },
	Normal: { cf: CF.normal, fields: { vector: [ MFVec3f, [] ], metadata: [ SFNode, null ] } },
	DirectionalLight: { cf: CF.children, fields: { ...LIGHT_FIELDS, direction: [ SFVec3f, [ 0, 0, - 1 ] ], global: [ SFBool, false ] } },
	PointLight: { cf: CF.children, fields: { ...LIGHT_FIELDS, location: [ SFVec3f, [ 0, 0, 0 ] ], radius: [ SFFloat, 100 ],
		attenuation: [ SFVec3f, [ 1, 0, 0 ] ], global: [ SFBool, true ] } },
	SpotLight: { cf: CF.children, fields: { ...LIGHT_FIELDS, location: [ SFVec3f, [ 0, 0, 0 ] ], direction: [ SFVec3f, [ 0, 0, - 1 ] ],
		radius: [ SFFloat, 100 ], attenuation: [ SFVec3f, [ 1, 0, 0 ] ], beamWidth: [ SFFloat, PI / 2 ], cutOffAngle: [ SFFloat, PI / 4 ],
		global: [ SFBool, true ] } },
	TimeSensor: { cf: CF.children, fields: { cycleInterval: [ SFTime, 1 ], loop: [ SFBool, false ], enabled: [ SFBool, true ],
		startTime: [ SFTime, 0 ], stopTime: [ SFTime, 0 ], pauseTime: [ SFTime, 0 ], resumeTime: [ SFTime, 0 ], description: [ SFString, '' ],
		metadata: [ SFNode, null ],
		// outputs
		fraction_changed: [ SFFloat, 0 ], time: [ SFTime, 0 ], cycleTime: [ SFTime, 0 ], elapsedTime: [ SFTime, 0 ], isActive: [ SFBool, false ], isPaused: [ SFBool, false ] } },
	PositionInterpolator: { cf: CF.children, fields: { ...INTERP( MFVec3f ), value_changed: [ SFVec3f, [ 0, 0, 0 ] ] } },
	OrientationInterpolator: { cf: CF.children, fields: { ...INTERP( MFRotation ), value_changed: [ SFRotation, [ 0, 0, 1, 0 ] ] } },
	ScalarInterpolator: { cf: CF.children, fields: { ...INTERP( MFFloat ), value_changed: [ SFFloat, 0 ] } },
	ColorInterpolator: { cf: CF.children, fields: { ...INTERP( MFColor ), value_changed: [ SFColor, [ 0, 0, 0 ] ] } },
};
// elements that are structure, not nodes
const STRUCTURAL = new Set( [ 'X3D', 'head', 'component', 'meta', 'unit', 'Scene', 'ROUTE', 'IMPORT', 'EXPORT' ] );
export const CONTRACT_NODES = Object.keys( NODE_SPECS ).concat( [ 'ROUTE', 'meta' ] );

const ARITY = { [ SFVec2f ]: 2, [ SFVec3f ]: 3, [ SFRotation ]: 4, [ SFColor ]: 3, [ SFVec4f ]: 4, [ SFColorRGBA ]: 4,
	[ MFVec2f ]: 2, [ MFVec3f ]: 3, [ MFRotation ]: 4, [ MFColor ]: 3, [ MFFloat ]: 1, [ MFInt32 ]: 1 };

// ---------------------------------------------------------------------------------------------
// value parsing (XML encoding)
// ---------------------------------------------------------------------------------------------
function parseNumbers( s ) {
	const t = s.trim();
	if ( t === '' ) return [];
	const parts = t.split( /[\s,]+/ );
	const out = new Array( parts.length );
	let n = 0;
	for ( let i = 0; i < parts.length; i ++ ) { if ( parts[ i ] !== '' ) out[ n ++ ] = Number( parts[ i ] ); }
	out.length = n;
	return out;
}
function parseMFString( s ) {
	const out = [];
	const re = /"((?:[^"\\]|\\.)*)"/g;
	let m, any = false;
	while ( ( m = re.exec( s ) ) !== null ) { any = true; out.push( m[ 1 ].replace( /\\(.)/g, '$1' ) ); }
	if ( ! any && s.trim() !== '' ) out.push( s.trim() );
	return out;
}
function parseValue( type, s ) {
	switch ( type ) {
		case SFBool: return /^\s*true\s*$/i.test( s );
		case SFInt32: return parseInt( s, 10 ) | 0;
		case SFFloat: case SFTime: return Number( s.trim() );
		case SFString: return s;
		case MFString: return parseMFString( s );
		case MFInt32: return Int32Array.from( parseNumbers( s ) );
		case MFFloat: case MFVec2f: case MFVec3f: case MFRotation: case MFColor: {
			const a = parseNumbers( s ), k = ARITY[ type ];
			if ( a.length % k !== 0 ) a.length -= a.length % k;
			return Float32Array.from( a );
		}
		default: {
			const k = ARITY[ type ];
			if ( k ) { const a = parseNumbers( s ); const v = new Float64Array( k ); for ( let i = 0; i < k && i < a.length; i ++ ) v[ i ] = a[ i ]; return v; }
			return s;
		}
	}
}
function defaultValue( type, d ) {
	switch ( type ) {
		case MFNode: return [];
		case MFString: return d.slice();
		case MFInt32: return Int32Array.from( d );
		case MFFloat: case MFVec2f: case MFVec3f: case MFRotation: case MFColor: return Float32Array.from( d );
		default: if ( ARITY[ type ] ) return Float64Array.from( d ); return d;
	}
}

// ---------------------------------------------------------------------------------------------
// X3D node runtime object
// ---------------------------------------------------------------------------------------------
let _nodeIds = 0;
// one prototype per node type, so every type's field object gets its own V8 hidden-class tree: a field such as
// value_changed (a number in ScalarInterpolator, an array in PositionInterpolator) then keeps an unboxed Double
// representation where it is numeric, and per-frame stores of animated values allocate nothing
const FIELD_PROTOS = Object.create( null );
class X3DNode {
	constructor( type, def ) {
		this.id = ++ _nodeIds;
		this.type = type;
		this.def = def || '';
		this.spec = NODE_SPECS[ type ];
		this.f = Object.create( FIELD_PROTOS[ type ] || ( FIELD_PROTOS[ type ] = { __x3dType: type } ) );
		this.instances = []; // three.js objects (one per scene-graph occurrence)
		this.routesOut = null; // Map fieldName -> [route]
		this.animated = null; // Set of fields that are ROUTE targets
		this.useCount = 0;
		this.rt = null; // runtime record (material uniforms, light, interpolator state ...)
		for ( const name in this.spec.fields ) { const [ t, d ] = this.spec.fields[ name ]; this.f[ name ] = defaultValue( t, d ); }
	}
	fieldType( name ) { const s = this.spec.fields[ name ]; return s ? s[ 0 ] : 0; }
	isAnimated( name ) { return this.animated !== null && this.animated.has( name ); }
}

// ---------------------------------------------------------------------------------------------
// X3D light classes + light nodes (exact X_ITE physical light model)
// ---------------------------------------------------------------------------------------------
function x3dLightParams() {
	return { attenuation: new THREE.Vector3( 1, 0, 0 ), radius: 100, beamWidth: PI / 2, cutOffAngle: PI / 4, distScale: 1 };
}
export class X3DSpotLight extends THREE.SpotLight {
	constructor() { super(); this.isX3DLight = true; this.x3d = x3dLightParams(); }
}
export class X3DPointLight extends THREE.PointLight {
	constructor() { super(); this.isX3DLight = true; this.x3d = x3dLightParams(); }
}

// X3D/X_ITE physical (PBR) attenuation and the classic (Material / Phong) model.
function x3dAttenuation( att, d, radius ) {
	const a = float( 1 ).div( max( dot( att, vec3( 1, d, d.mul( d ) ) ), 1 ) );
	const window = max( min( float( 1 ).sub( pow( d.div( radius ), 4 ) ), 1 ), 0 );
	const invSq = float( 1 ).div( max( d.mul( d ), 1e-4 ) );
	return a.mul( select( radius.greaterThan( 0 ), window, 1 ) ).mul( invSq );
}
function x3dClassicAttenuation( att, d, radius ) {
	// X3D 4.0 (Phong) : 1 / max(a0 + a1 d + a2 d^2, 1), zero beyond radius; x PI cancels three's Lambert 1/PI.
	const a = float( 1 ).div( max( dot( att, vec3( 1, d, d.mul( d ) ) ), 1 ) );
	return a.mul( select( d.lessThanEqual( radius ), 1, 0 ) ).mul( PI );
}

export class X3DSpotLightNode extends THREE.SpotLightNode {
	static get type() { return 'X3DSpotLightNode'; }
	constructor( light = null ) {
		super( light );
		this.x3dAttNode = uniform( new THREE.Vector3( 1, 0, 0 ) ).setGroup( renderGroup );
		this.x3dRadiusNode = uniform( 100 ).setGroup( renderGroup );
		this.x3dCosOuterNode = uniform( 0 ).setGroup( renderGroup );
		this.x3dCosInnerNode = uniform( 1 ).setGroup( renderGroup );
		this.x3dBeamNode = uniform( 0 ).setGroup( renderGroup );
		this.x3dCutNode = uniform( 0 ).setGroup( renderGroup );
		this.x3dDistScaleNode = uniform( 1 ).setGroup( renderGroup );
	}
	update( frame ) {
		super.update( frame );
		const x = this.light.x3d;
		this.x3dAttNode.value.copy( x.attenuation );
		this.x3dRadiusNode.value = x.radius;
		const cut = Math.min( Math.max( x.cutOffAngle, 0 ), PI / 2 );
		const beam = Math.min( Math.max( x.beamWidth, 0 ), cut );
		const co = Math.cos( cut );
		let ci = Math.cos( beam );
		if ( ci - co < 1e-4 ) ci = co + 1e-4;
		this.x3dCosOuterNode.value = co;
		this.x3dCosInnerNode.value = ci;
		this.x3dBeamNode.value = beam;
		this.x3dCutNode.value = cut;
		this.x3dDistScaleNode.value = x.distScale;
	}
	setupDirect( builder ) {
		const lightVector = this.getLightVector( builder );
		const lightDirection = lightVector.normalize();
		const d = lightVector.length().mul( this.x3dDistScaleNode );
		const cosA = lightDirection.dot( lightTargetDirection( this.light ) );
		const classic = builder.material && builder.material.userData && builder.material.userData.x3dClassic === true;
		let spot, atten;
		if ( classic ) {
			const ang = acos( clamp( cosA, - 1, 1 ) );
			const lin = ang.sub( this.x3dCutNode ).div( min( this.x3dBeamNode.sub( this.x3dCutNode ), - 1e-4 ) );
			spot = select( ang.greaterThanEqual( this.x3dCutNode ), 0, select( ang.lessThanEqual( this.x3dBeamNode ), 1, lin ) );
			atten = x3dClassicAttenuation( this.x3dAttNode, d, this.x3dRadiusNode );
		} else {
			const t = clamp( cosA.sub( this.x3dCosOuterNode ).div( this.x3dCosInnerNode.sub( this.x3dCosOuterNode ) ), 0, 1 );
			spot = t.mul( t );
			atten = x3dAttenuation( this.x3dAttNode, d, this.x3dRadiusNode );
		}
		const lightColor = this.colorNode.mul( spot ).mul( atten );
		return { lightColor, lightDirection };
	}
}
export class X3DPointLightNode extends THREE.PointLightNode {
	static get type() { return 'X3DPointLightNode'; }
	constructor( light = null ) {
		super( light );
		this.x3dAttNode = uniform( new THREE.Vector3( 1, 0, 0 ) ).setGroup( renderGroup );
		this.x3dRadiusNode = uniform( 100 ).setGroup( renderGroup );
		this.x3dDistScaleNode = uniform( 1 ).setGroup( renderGroup );
	}
	update( frame ) {
		super.update( frame );
		const x = this.light.x3d;
		this.x3dAttNode.value.copy( x.attenuation );
		this.x3dRadiusNode.value = x.radius;
		this.x3dDistScaleNode.value = x.distScale;
	}
	setupDirect( builder ) {
		const lightVector = this.getLightVector( builder );
		const lightDirection = lightVector.normalize();
		const d = lightVector.length().mul( this.x3dDistScaleNode );
		const classic = builder.material && builder.material.userData && builder.material.userData.x3dClassic === true;
		const atten = classic ? x3dClassicAttenuation( this.x3dAttNode, d, this.x3dRadiusNode ) : x3dAttenuation( this.x3dAttNode, d, this.x3dRadiusNode );
		return { lightColor: this.colorNode.mul( atten ), lightDirection };
	}
}
/** Register the X3D light models with a renderer (WebGPU or WebGL2 backend). Idempotent. */
export function registerX3DLights( renderer ) {
	if ( ! renderer || ! renderer.library || renderer.library.__x3dLights ) return;
	renderer.library.addLight( X3DSpotLightNode, X3DSpotLight );
	renderer.library.addLight( X3DPointLightNode, X3DPointLight );
	renderer.library.__x3dLights = true;
}

// ---------------------------------------------------------------------------------------------
// Display mapping (X_ITE parity): output = pow(neutral(L * exposure), 1/2.2)
// ---------------------------------------------------------------------------------------------
export const neutralToneMap = /*@__PURE__*/ Fn( ( [ c ] ) => {
	const x = min( c.r, min( c.g, c.b ) );
	const offset = select( x.lessThan( 0.08 ), x.sub( x.mul( x ).mul( 6.25 ) ), 0.04 );
	const c1 = c.sub( offset ).toVar();
	const peak = max( c1.r, max( c1.g, c1.b ) );
	const newPeak = float( 1 ).sub( float( 0.0576 ).div( max( peak.sub( 0.52 ), 1e-5 ) ) );
	const c2 = c1.mul( newPeak.div( max( peak, 1e-5 ) ) );
	const g = float( 1 ).sub( float( 1 ).div( peak.sub( newPeak ).mul( 0.15 ).add( 1 ) ) );
	return select( peak.lessThan( 0.76 ), c1, mix( c2, vec3( newPeak ), g ) );
} ).setLayout( { name: 'x3dNeutralToneMap', type: 'vec3', inputs: [ { name: 'c', type: 'vec3' } ] } );

export const neutralInverse = /*@__PURE__*/ Fn( ( [ D ] ) => {
	const p = min( max( D.r, max( D.g, D.b ) ), 0.9995 );
	const peak = float( 0.52 ).add( float( 0.0576 ).div( float( 1 ).sub( p ) ) );
	const g = float( 1 ).sub( float( 1 ).div( peak.sub( p ).mul( 0.15 ).add( 1 ) ) );
	const c2 = D.sub( vec3( p ).mul( g ) ).div( max( float( 1 ).sub( g ), 1e-5 ) );
	const c1 = select( p.lessThan( 0.76 ), D, c2.mul( peak.div( max( p, 1e-5 ) ) ) ).toVar();
	const x1 = max( min( c1.r, min( c1.g, c1.b ) ), 0 );
	const x = select( x1.lessThan( 0.04 ), sqrt( x1.div( 6.25 ) ), x1.add( 0.04 ) );
	return c1.add( x.sub( x1 ) );
} ).setLayout( { name: 'x3dNeutralInverse', type: 'vec3', inputs: [ { name: 'D', type: 'vec3' } ] } );

/** X_ITE draws UnlitMaterial/Background display-referred: D = neutral(S). Return linear L with
 *  pow(neutral(L), 1/2.2) == D, so the engine's output transform lands on X_ITE's pixel. */
export const unlitDisplayToLinear = /*@__PURE__*/ Fn( ( [ S ] ) => {
	const D = neutralToneMap( max( S, vec3( 0 ) ) );
	return neutralInverse( pow( D, vec3( 2.2 ) ) );
} ).setLayout( { name: 'x3dUnlitDisplayToLinear', type: 'vec3', inputs: [ { name: 'S', type: 'vec3' } ] } );

// global uniforms shared by every loaded world (the engine may drive them)
export const x3dGlobals = {
	unlitGain: uniform( 1 ), // multiplies unlit/background linear output (engine: emissive boost for bloom / 1/exposure)
	emissiveGain: uniform( 1 ), // multiplies PhysicalMaterial emissive (engine: bloom)
};

// ---------------------------------------------------------------------------------------------
// Geometry: IndexedFaceSet core (X_ITE-compatible normals and texture coordinates)
// ---------------------------------------------------------------------------------------------
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3(), _vd = new THREE.Vector3();

function faceNormal( P, idx, out ) { // idx: array of point indices of one polygon; X_ITE getNormal/getQuadNormal/Newell
	const n = idx.length;
	if ( n === 3 ) {
		_va.fromArray( P, idx[ 0 ] * 3 ); _vb.fromArray( P, idx[ 1 ] * 3 ); _vc.fromArray( P, idx[ 2 ] * 3 );
		out.subVectors( _vc, _vb ).cross( _vd.subVectors( _va, _vb ) ).normalize();
		return out;
	}
	if ( n === 4 ) {
		_va.fromArray( P, idx[ 0 ] * 3 ); _vb.fromArray( P, idx[ 1 ] * 3 ); _vc.fromArray( P, idx[ 2 ] * 3 ); _vd.fromArray( P, idx[ 3 ] * 3 );
		const ac = new THREE.Vector3().subVectors( _vc, _va ), bd = new THREE.Vector3().subVectors( _vd, _vb );
		out.crossVectors( ac, bd ).normalize();
		return out;
	}
	out.set( 0, 0, 0 );
	for ( let i = 0; i < n; i ++ ) {
		_va.fromArray( P, idx[ i ] * 3 ); _vb.fromArray( P, idx[ ( i + 1 ) % n ] * 3 );
		out.x += ( _va.y - _vb.y ) * ( _va.z + _vb.z );
		out.y += ( _va.z - _vb.z ) * ( _va.x + _vb.x );
		out.z += ( _va.x - _vb.x ) * ( _va.y + _vb.y );
	}
	return out.normalize();
}

function triangulate( P, poly, convex ) { // poly: point indices; returns local corner triples (CCW about the polygon normal)
	const n = poly.length;
	const tris = [];
	if ( convex || n === 3 ) { for ( let i = 1; i < n - 1; i ++ ) tris.push( 0, i, i + 1 ); return tris; }
	// concave (convex FALSE): project onto the polygon plane in a right-handed (u, v, n) basis and ear-clip
	const nrm = faceNormal( P, poly, new THREE.Vector3() );
	const u = Math.abs( nrm.x ) > 0.9 ? new THREE.Vector3( 0, 1, 0 ) : new THREE.Vector3( 1, 0, 0 );
	u.cross( nrm ).normalize();
	const v = new THREE.Vector3().crossVectors( nrm, u );
	const pts = [], p = new THREE.Vector3();
	for ( let i = 0; i < n; i ++ ) { p.fromArray( P, poly[ i ] * 3 ); pts.push( new THREE.Vector2( p.dot( u ), p.dot( v ) ) ); }
	const faces = THREE.ShapeUtils.triangulateShape( pts, [] );
	for ( const f of faces ) {
		const a = pts[ f[ 0 ] ], b = pts[ f[ 1 ] ], c = pts[ f[ 2 ] ];
		const area = ( b.x - a.x ) * ( c.y - a.y ) - ( b.y - a.y ) * ( c.x - a.x );
		if ( area >= 0 ) tris.push( f[ 0 ], f[ 1 ], f[ 2 ] ); else tris.push( f[ 0 ], f[ 2 ], f[ 1 ] );
	}
	return tris;
}

/**
 * Build a BufferGeometry from IndexedFaceSet-style data.
 * d = { P: Float32Array points, coordIndex: Int32Array (with -1 separators), T?: Float32Array 2D points, texCoordIndex?,
 *       N?: Float32Array vectors, normalIndex?, normalPerVertex, ccw, convex, creaseAngle }
 */
export function buildIndexedFaceSet( d ) {
	const P = d.P, ci = d.coordIndex, ccw = d.ccw !== false, convex = d.convex !== false;
	const nPoints = P.length / 3;
	// polygons as lists of coordIndex positions
	const polys = [];
	let cur = [];
	for ( let i = 0; i < ci.length; i ++ ) {
		const v = ci[ i ];
		if ( v < 0 ) { if ( cur.length >= 3 ) polys.push( cur ); cur = []; } else if ( v < nPoints ) cur.push( i ); else { cur = [ - 1 ]; }
	}
	if ( cur.length >= 3 ) polys.push( cur );
	const validPolys = polys.filter( p => p[ 0 ] !== - 1 );
	// face normals (unit, X_ITE), negated for ccw=false
	const fN = new Float32Array( validPolys.length * 3 );
	const tmp = new THREE.Vector3();
	for ( let f = 0; f < validPolys.length; f ++ ) {
		faceNormal( P, validPolys[ f ].map( k => ci[ k ] ), tmp );
		if ( ! ccw ) tmp.negate();
		fN[ f * 3 ] = tmp.x; fN[ f * 3 + 1 ] = tmp.y; fN[ f * 3 + 2 ] = tmp.z;
	}
	// per-corner normals
	const cornerFace = new Map(); // coordIndex position -> face
	for ( let f = 0; f < validPolys.length; f ++ ) for ( const k of validPolys[ f ] ) cornerFace.set( k, f );
	const getCornerNormal = ( () => {
		if ( d.N && d.N.length >= 3 ) {
			const N = d.N, ni = d.normalIndex, perVertex = d.normalPerVertex !== false, nN = N.length / 3;
			return ( k, f, out ) => {
				let idx;
				if ( perVertex ) idx = ( ni && ni.length > k && ni[ k ] >= 0 ) ? ni[ k ] : ci[ k ];
				else idx = ( ni && ni.length > f ) ? ni[ f ] : f;
				idx = Math.min( Math.max( idx, 0 ), nN - 1 );
				return out.set( N[ idx * 3 ], N[ idx * 3 + 1 ], N[ idx * 3 + 2 ] ).normalize();
			};
		}
		const crease = d.creaseAngle || 0;
		if ( crease <= 0 || d.normalPerVertex === false ) return ( k, f, out ) => out.fromArray( fN, f * 3 );
		const cosC = Math.cos( Math.min( Math.max( crease, 0 ), PI ) );
		const byPoint = new Map(); // point -> faces sharing it (corner order)
		for ( let f = 0; f < validPolys.length; f ++ ) for ( const k of validPolys[ f ] ) { const p = ci[ k ]; let a = byPoint.get( p ); if ( ! a ) byPoint.set( p, a = [] ); a.push( f ); }
		return ( k, f, out ) => {
			const list = byPoint.get( ci[ k ] );
			const fx = fN[ f * 3 ], fy = fN[ f * 3 + 1 ], fz = fN[ f * 3 + 2 ];
			let x = 0, y = 0, z = 0;
			for ( const g of list ) {
				const gx = fN[ g * 3 ], gy = fN[ g * 3 + 1 ], gz = fN[ g * 3 + 2 ];
				if ( gx * fx + gy * fy + gz * fz > cosC ) { x += gx; y += gy; z += gz; }
			}
			return out.set( x, y, z ).normalize();
		};
	} )();
	// texture coordinates
	let getUV;
	if ( d.T && d.T.length >= 2 ) {
		const T = d.T, ti = d.texCoordIndex, nT = T.length / 2;
		getUV = ( k, out ) => { let idx = ( ti && ti.length > k && ti[ k ] >= 0 ) ? ti[ k ] : ci[ k ]; idx = Math.min( Math.max( idx, 0 ), nT - 1 ); out[ 0 ] = T[ idx * 2 ]; out[ 1 ] = T[ idx * 2 + 1 ]; };
	} else {
		// X3D default IFS texture mapping: S along the largest bbox dimension, T along the second, same scale
		const mn = [ Infinity, Infinity, Infinity ], mx = [ - Infinity, - Infinity, - Infinity ];
		for ( let i = 0; i < P.length; i += 3 ) for ( let a = 0; a < 3; a ++ ) { mn[ a ] = Math.min( mn[ a ], P[ i + a ] ); mx[ a ] = Math.max( mx[ a ], P[ i + a ] ); }
		const size = [ 0, 1, 2 ].map( a => mx[ a ] - mn[ a ] );
		const order = [ 0, 1, 2 ].sort( ( a, b ) => size[ b ] - size[ a ] );
		const S = order[ 0 ], Tt = order[ 1 ], sz = size[ S ] || 1;
		getUV = ( k, out ) => { const o = ci[ k ] * 3; out[ 0 ] = ( P[ o + S ] - mn[ S ] ) / sz; out[ 1 ] = ( P[ o + Tt ] - mn[ Tt ] ) / sz; };
	}
	// emit de-duplicated vertices
	const pos = [], nor = [], uvs = [], index = [];
	const keyMap = new Map();
	const nrm = new THREE.Vector3(), uvv = [ 0, 0 ];
	const cornerVertex = ( k, f ) => {
		getCornerNormal( k, f, nrm ); getUV( k, uvv );
		const key = ci[ k ] + '|' + uvv[ 0 ].toFixed( 6 ) + ',' + uvv[ 1 ].toFixed( 6 ) + '|' + nrm.x.toFixed( 5 ) + ',' + nrm.y.toFixed( 5 ) + ',' + nrm.z.toFixed( 5 );
		let v = keyMap.get( key );
		if ( v === undefined ) {
			v = pos.length / 3; keyMap.set( key, v );
			const o = ci[ k ] * 3; pos.push( P[ o ], P[ o + 1 ], P[ o + 2 ] ); nor.push( nrm.x, nrm.y, nrm.z ); uvs.push( uvv[ 0 ], uvv[ 1 ] );
		}
		return v;
	};
	for ( let f = 0; f < validPolys.length; f ++ ) {
		const poly = validPolys[ f ];
		const tri = triangulate( P, poly.map( k => ci[ k ] ), convex );
		for ( let t = 0; t < tri.length; t += 3 ) {
			const a = cornerVertex( poly[ tri[ t ] ], f ), b = cornerVertex( poly[ tri[ t + 1 ] ], f ), c = cornerVertex( poly[ tri[ t + 2 ] ], f );
			if ( ccw ) index.push( a, b, c ); else index.push( a, c, b );
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new THREE.Float32BufferAttribute( nor, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	g.setIndex( pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute( index, 1 ) : new THREE.Uint16BufferAttribute( index, 1 ) );
	g.computeBoundingSphere(); g.computeBoundingBox();
	g.userData.polygons = validPolys.length;
	return g;
}

// ---- X_ITE primitive tessellations (as IndexedFaceSet data) -----------------------------------
function boxData( size ) {
	const sx = Math.abs( size[ 0 ] ) / 2, sy = Math.abs( size[ 1 ] ) / 2, sz = Math.abs( size[ 2 ] ) / 2;
	const p = [ 1, 1, 1, - 1, 1, 1, - 1, - 1, 1, 1, - 1, 1, 1, 1, - 1, - 1, 1, - 1, - 1, - 1, - 1, 1, - 1, - 1 ];
	for ( let i = 0; i < p.length; i += 3 ) { p[ i ] *= sx; p[ i + 1 ] *= sy; p[ i + 2 ] *= sz; }
	return { P: Float32Array.from( p ), coordIndex: Int32Array.from( [ 0, 1, 2, 3, - 1, 5, 4, 7, 6, - 1, 1, 5, 6, 2, - 1, 4, 0, 3, 7, - 1, 4, 5, 1, 0, - 1, 3, 2, 6, 7, - 1 ] ),
		T: Float32Array.from( [ 1, 1, 0, 1, 0, 0, 1, 0 ] ), texCoordIndex: Int32Array.from( [ 0, 1, 2, 3, - 1, 0, 1, 2, 3, - 1, 0, 1, 2, 3, - 1, 0, 1, 2, 3, - 1, 0, 1, 2, 3, - 1, 0, 1, 2, 3, - 1 ] ),
		ccw: true, convex: true, creaseAngle: 0 };
}
function sphereData( radius, xDim = 32, yDim = 15 ) {
	const e = xDim + 1, t = yDim, P = [], T = [], ci = [], ti = [];
	// points
	P.push( 0, 1, 0 );
	for ( let n = 1, s = t - 1; n < s; ++ n ) {
		const th = - PI * n / s, real = Math.cos( th ), imag = Math.sin( th );
		for ( let m = 0, s2 = e - 1; m < s2; ++ m ) { const ph = 2 * PI * m / s2; P.push( imag * Math.sin( ph ), real, imag * Math.cos( ph ) ); }
	}
	P.push( 0, - 1, 0 );
	for ( let i = 0; i < P.length; i ++ ) P[ i ] *= radius;
	// texture coordinates
	const half = - 0.5 / ( e - 1 );
	for ( let i = 1; i < e; ++ i ) T.push( i / ( e - 1 ) + half, 1 );
	for ( let n = 1, s = t - 1; n < s; ++ n ) { const v = 1 - n / ( t - 1 ); for ( let i = 0; i < e; ++ i ) T.push( i / ( e - 1 ), v ); }
	for ( let i = 1; i < e; ++ i ) T.push( i / ( e - 1 ) + half, 0 );
	// texCoordIndex
	for ( let i = 0, n = e - 1; i < n; ++ i ) ti.push( i, i + e - 1, i + e, - 1 );
	for ( let n = e - 1, s = 0, r = t - 3; s < r; ++ s, ++ n ) for ( let i = 0, m = e - 1; i < m; ++ i, ++ n ) ti.push( n, n + e, n + e + 1, n + 1, - 1 );
	{ let n = ( t - 2 ) * e - 1; for ( let i = 0, m = e - 1; i < m; ++ i, ++ n ) ti.push( n + e, n + 1, n, - 1 ); }
	// coordIndex
	let n = 1;
	for ( const lim = e - 1; n < lim; ++ n ) ci.push( 0, n, n + 1, - 1 );
	ci.push( 0, n, 1, - 1 );
	let s = 1;
	for ( let b = 0, r = t - 3; b < r; ++ b, ++ s ) {
		for ( let i = 0, m = e - 2; i < m; ++ i, ++ s ) ci.push( s, s + e - 1, s + e, s + 1, - 1 );
		ci.push( s, s + e - 1, s + 1, s - e + 2, - 1 );
	}
	const rr = s + e - 1;
	for ( let i = 0, m = e - 2; i < m; ++ i, ++ s ) ci.push( rr, s + 1, s, - 1 );
	ci.push( rr, rr - e + 1, s, - 1 );
	return { P: Float32Array.from( P ), coordIndex: Int32Array.from( ci ), T: Float32Array.from( T ), texCoordIndex: Int32Array.from( ti ), ccw: true, convex: true, creaseAngle: PI };
}
function cylinderData( radius, height, top, side, bottom, dim = 20 ) {
	const h = Math.abs( height ) / 2, r = Math.abs( radius ), P = [], T = [], N = [], ci = [], ti = [], ni = [];
	for ( let i = 0; i < dim; ++ i ) { const a = 2 * PI * i / dim; P.push( - Math.sin( a ) * r, - h, - Math.cos( a ) * r ); }
	for ( let i = 0; i < dim; ++ i ) { const a = 2 * PI * i / dim; P.push( - Math.sin( a ) * r, h, - Math.cos( a ) * r ); }
	for ( let i = 0; i < dim + 1; ++ i ) T.push( i / dim, 0 );
	for ( let i = 0; i < dim + 1; ++ i ) T.push( i / dim, 1 );
	for ( let i = 0; i < dim; ++ i ) { const a = 2 * PI * i / dim; T.push( ( - Math.sin( a ) + 1 ) / 2, ( - Math.cos( a ) + 1 ) / 2 ); }
	for ( let i = 0; i < dim; ++ i ) { const a = 2 * PI * i / dim; T.push( 1 - ( Math.sin( a ) + 1 ) / 2, ( Math.cos( a ) + 1 ) / 2 ); }
	for ( let i = 0; i < dim; ++ i ) { const a = 2 * PI * i / dim; N.push( - Math.sin( a ), 0, - Math.cos( a ) ); }
	N.push( 0, - 1, 0, 0, 1, 0 );
	if ( side ) for ( let i = 0; i < dim; ++ i ) { ci.push( i, ( i + 1 ) % dim, ( i + 1 ) % dim + dim, i + dim, - 1 ); ti.push( i, i + 1, i + 2 + dim, i + 1 + dim, - 1 ); ni.push( i, ( i + 1 ) % dim, ( i + 1 ) % dim, i, - 1 ); }
	if ( top ) { for ( let i = 0; i < dim; ++ i ) { ci.push( i + dim ); ti.push( 2 * ( dim + 1 ) + dim + i ); ni.push( dim + 1 ); } ci.push( - 1 ); ti.push( - 1 ); ni.push( - 1 ); }
	if ( bottom ) { for ( let i = dim - 1; i > - 1; -- i ) { ci.push( i ); ti.push( 2 * ( dim + 1 ) + i ); ni.push( dim ); } ci.push( - 1 ); ti.push( - 1 ); ni.push( - 1 ); }
	return { P: Float32Array.from( P ), coordIndex: Int32Array.from( ci ), T: Float32Array.from( T ), texCoordIndex: Int32Array.from( ti ),
		N: Float32Array.from( N ), normalIndex: Int32Array.from( ni ), normalPerVertex: true, ccw: true, convex: true };
}
function coneData( bottomRadius, height, side, bottom, dim = 20 ) {
	const h = Math.abs( height ), hh = h / 2, r = Math.abs( bottomRadius ), P = [], T = [], N = [], ci = [], ti = [], ni = [];
	for ( let i = 0; i < dim; ++ i ) { const a = 2 * PI * i / dim; P.push( - Math.sin( a ) * r, - hh, - Math.cos( a ) * r ); }
	P.push( 0, hh, 0 );
	for ( let i = 0; i < dim + 1; ++ i ) T.push( i / dim, 0 );
	for ( let i = 0; i < dim + 1; ++ i ) T.push( ( i + 0.5 ) / dim, 1 );
	for ( let i = 0; i < dim; ++ i ) { const a = 2 * PI * i / dim; T.push( ( - Math.sin( a ) + 1 ) / 2, ( - Math.cos( a ) + 1 ) / 2 ); }
	// side normals tilted by atan(r/h) (X_ITE Cone.build)
	const tilt = Math.atan( r / ( h || 1e-9 ) ), cy = Math.sin( tilt ), cxz = Math.cos( tilt );
	for ( let i = 0; i < dim; ++ i ) { const a = 2 * PI * i / dim; N.push( - Math.sin( a ) * cxz, cy, - Math.cos( a ) * cxz ); }
	for ( let i = 0; i < dim; ++ i ) { const a = 2 * PI * ( i + 0.5 ) / dim; N.push( - Math.sin( a ) * cxz, cy, - Math.cos( a ) * cxz ); }
	N.push( 0, - 1, 0 );
	if ( side ) for ( let i = 0; i < dim; ++ i ) { ci.push( i, ( i + 1 ) % dim, dim, - 1 ); ti.push( i, i + 1, i + dim + 1, - 1 ); ni.push( i, ( i + 1 ) % dim, i + dim, - 1 ); }
	if ( bottom ) { for ( let i = dim - 1; i > - 1; -- i ) { ci.push( i ); ti.push( 2 * ( dim + 1 ) + i ); ni.push( 2 * dim ); } ci.push( - 1 ); ti.push( - 1 ); ni.push( - 1 ); }
	return { P: Float32Array.from( P ), coordIndex: Int32Array.from( ci ), T: Float32Array.from( T ), texCoordIndex: Int32Array.from( ti ),
		N: Float32Array.from( N ), normalIndex: Int32Array.from( ni ), normalPerVertex: true, ccw: true, convex: true };
}

// ---------------------------------------------------------------------------------------------
// math helpers
// ---------------------------------------------------------------------------------------------
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _axis = new THREE.Vector3();
// Hot-path helpers write object fields directly instead of calling set(x, y, z): a double passed as an argument to a
// function V8 does not inline is boxed (one HeapNumber per argument per call).
function quatFromRotation( r, out, o = 0 ) {
	const x = r[ o ], y = r[ o + 1 ], z = r[ o + 2 ], a = r[ o + 3 ];
	const len = Math.sqrt( x * x + y * y + z * z );
	if ( len < 1e-12 ) { out._x = 0; out._y = 0; out._z = 0; out._w = 1; return out; }
	const sh = Math.sin( a * 0.5 ) / len;
	out._x = x * sh; out._y = y * sh; out._z = z * sh; out._w = Math.cos( a * 0.5 );
	return out;
}
function rotationFromQuat( q, out ) { // SFRotation from a unit quaternion
	let w = Math.min( 1, Math.max( - 1, q.w ) );
	const angle = 2 * Math.acos( w );
	const s = Math.sqrt( 1 - w * w );
	if ( s < 1e-9 ) { out[ 0 ] = 0; out[ 1 ] = 0; out[ 2 ] = 1; out[ 3 ] = 0; } else { out[ 0 ] = q.x / s; out[ 1 ] = q.y / s; out[ 2 ] = q.z / s; out[ 3 ] = angle; }
	return out;
}
/** X3D Transform matrix: T x C x R x SR x S x -SR x -C */
function x3dTransformMatrix( f, out ) {
	const t = f.translation, c = f.center, s = f.scale, so = f.scaleOrientation;
	quatFromRotation( f.rotation, _q1 );
	const hasSO = so[ 3 ] !== 0 && ( s[ 0 ] !== s[ 1 ] || s[ 1 ] !== s[ 2 ] );
	_v1.x = t[ 0 ]; _v1.y = t[ 1 ]; _v1.z = t[ 2 ]; _v2.x = s[ 0 ]; _v2.y = s[ 1 ]; _v2.z = s[ 2 ];
	if ( ! hasSO && c[ 0 ] === 0 && c[ 1 ] === 0 && c[ 2 ] === 0 ) return out.compose( _v1, _q1, _v2 );
	// T x C x R x SR x S x -SR x -C, built with element writes (no double arguments)
	const e = out.identity().elements;
	e[ 12 ] = t[ 0 ] + c[ 0 ]; e[ 13 ] = t[ 1 ] + c[ 1 ]; e[ 14 ] = t[ 2 ] + c[ 2 ];
	out.multiply( _m1.makeRotationFromQuaternion( _q1 ) );
	if ( hasSO ) { quatFromRotation( so, _q2 ); out.multiply( _m1.makeRotationFromQuaternion( _q2 ) ); }
	const m = _m1.identity().elements; m[ 0 ] = s[ 0 ]; m[ 5 ] = s[ 1 ]; m[ 10 ] = s[ 2 ];
	out.multiply( _m1 );
	if ( hasSO ) { _q2._x = - _q2._x; _q2._y = - _q2._y; _q2._z = - _q2._z; out.multiply( _m1.makeRotationFromQuaternion( _q2 ) ); }
	const n = _m1.identity().elements; n[ 12 ] = - c[ 0 ]; n[ 13 ] = - c[ 1 ]; n[ 14 ] = - c[ 2 ];
	out.multiply( _m1 );
	return out;
}
/** X3D TextureTransform on texture coordinates: Tc' = -C x S x R x C x T x Tc (translation first). */
function x3dTextureMatrix( f, out ) {
	const tx = f.translation[ 0 ], ty = f.translation[ 1 ], cx = f.center[ 0 ], cy = f.center[ 1 ];
	const sx = f.scale[ 0 ], sy = f.scale[ 1 ], c = Math.cos( f.rotation ), s = Math.sin( f.rotation );
	// M = T(-C) * S * R * T(C) * T(T)   (column vectors, applied right to left)
	const ux = cx + tx, uy = cy + ty; // after T and C
	// R * (p + u) = R p + R u ; then S ; then -C
	const a = sx * c, b = - sx * s, d = sy * s, e = sy * c;
	const ox = a * ux + b * uy - cx, oy = d * ux + e * uy - cy;
	out.set( a, b, ox, d, e, oy, 0, 0, 1 );
	return out;
}
function hsvFromRGB( r, g, b, out, o ) { // X_ITE Color3.getHSV (hue in radians)
	const mn = Math.min( r, g, b ), mx = Math.max( r, g, b ), dl = mx - mn;
	let h = 0, s = 0;
	if ( mx !== 0 && dl !== 0 ) { s = dl / mx; h = r === mx ? ( g - b ) / dl : g === mx ? 2 + ( b - r ) / dl : 4 + ( r - g ) / dl; h *= PI / 3; if ( h < 0 ) h += 2 * PI; }
	out[ o ] = h; out[ o + 1 ] = s; out[ o + 2 ] = mx;
}
function rgbFromHSV( h, s, v, out ) { // X_ITE Color3.setHSV
	s = Math.max( s, 0 ); v = Math.max( v, 0 );
	if ( s === 0 ) { out[ 0 ] = out[ 1 ] = out[ 2 ] = v; return; }
	let hh = h % ( 2 * PI ); if ( hh < 0 ) hh += 2 * PI;
	const n = hh * 180 / PI / 60, i = Math.floor( n ), f = n - i, p = v * ( 1 - s ), q = v * ( 1 - s * f ), t = v * ( 1 - s * ( 1 - f ) );
	switch ( i % 6 ) {
		case 0: out[ 0 ] = v; out[ 1 ] = t; out[ 2 ] = p; break;
		case 1: out[ 0 ] = q; out[ 1 ] = v; out[ 2 ] = p; break;
		case 2: out[ 0 ] = p; out[ 1 ] = v; out[ 2 ] = t; break;
		case 3: out[ 0 ] = p; out[ 1 ] = q; out[ 2 ] = v; break;
		case 4: out[ 0 ] = t; out[ 1 ] = p; out[ 2 ] = v; break;
		default: out[ 0 ] = v; out[ 1 ] = p; out[ 2 ] = q;
	}
}

// ---------------------------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------------------------
const DEFAULT_OPTIONS = {
	renderer: null, // registers the X3D light nodes
	lightMode: 'x3d', // 'x3d' = X_ITE order, first maxLightsPerShape; 'cull' = geometric reach, strongest first
	maxLightsPerShape: 8,
	lightScale: 1, // global multiplier on every X3D light intensity (calibration hook)
	shadowMapSize: 2048,
	anisotropy: 8,
	mipFilter: 'linear', // 'nearest' = X_ITE 16.4.3 parity (LINEAR_MIPMAP_NEAREST, anisotropy 1)
	waitForTextures: true,
	onProgress: null, // (loaded, total, label)
	textureBase: null, // URL base for textures (default: the x3d file URL)
	instancing: true, // batch static repeated shapes into InstancedMesh
};

export class X3DWorld {
	constructor( options = {} ) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
		this.scene = new THREE.Scene();
		this.scene.name = 'X3DScene';
		this.camera = new THREE.PerspectiveCamera( 45, 16 / 9, 0.1, 1e5 );
		this.camera.name = 'X3DViewpointCamera';
		this.defs = new Map();
		this.nodes = [];
		this.routes = [];
		this.timeSensors = [];
		this.interpolators = [];
		this.viewpoints = [];
		this.boundViewpoint = null;
		this.navigationInfo = null;
		this.background = null;
		this.worldInfo = null;
		this.meta = {};
		this.components = [];
		this.profile = '';
		this.version = '';
		this.film = null;
		this.time = 0;
		this._stamp = 0;
		this._lightRecords = [];
		this._shapeRecords = [];
		this._lightsNodeCache = new Map();
		this._materialCache = new Map();
		this._geometryCache = new Map();
		this._textureCache = new Map();
		this._texturePromises = [];
		this._aspect = 16 / 9;
		this._fovDirty = true;
		this.stats = { nodes_by_type: {}, elements_by_type: {}, use_by_type: {}, parsed_by_type: {}, unsupported: [], unknown_fields: [],
			routes: { total: 0, resolved: 0, failed: [] }, interpolators: 0, keys: 0, meshes: 0, instanced_meshes: 0, instances: 0,
			lights: 0, light_instances: 0, materials_x3d: 0, material_variants: 0, light_sets: 0, textures: 0, geometries: 0, triangles: 0,
			timings_ms: {} };
	}

	// ----- parse ---------------------------------------------------------------------------
	parse( text, url = '' ) {
		const t0 = performance.now();
		this.url = url;
		const doc = new DOMParser().parseFromString( text, 'application/xml' );
		const err = doc.getElementsByTagName( 'parsererror' )[ 0 ];
		if ( err ) throw new Error( 'X3D XML parse error: ' + err.textContent.slice( 0, 300 ) );
		const root = doc.documentElement;
		if ( root.localName !== 'X3D' ) throw new Error( 'not an X3D document (root ' + root.localName + ')' );
		this.profile = root.getAttribute( 'profile' ) || '';
		this.version = root.getAttribute( 'version' ) || '';
		// census of every element in the file
		const all = root.getElementsByTagName( '*' );
		for ( let i = 0; i < all.length; i ++ ) {
			const el = all[ i ], tag = el.localName;
			this.stats.elements_by_type[ tag ] = ( this.stats.elements_by_type[ tag ] || 0 ) + 1;
			if ( el.hasAttribute( 'USE' ) ) this.stats.use_by_type[ tag ] = ( this.stats.use_by_type[ tag ] || 0 ) + 1;
			else if ( ! STRUCTURAL.has( tag ) ) this.stats.nodes_by_type[ tag ] = ( this.stats.nodes_by_type[ tag ] || 0 ) + 1;
			if ( ! NODE_SPECS[ tag ] && ! STRUCTURAL.has( tag ) ) this.stats.unsupported.push( tag );
		}
		this.stats.unsupported = [ ...new Set( this.stats.unsupported ) ];
		const head = root.getElementsByTagName( 'head' )[ 0 ];
		if ( head ) for ( const el of head.children ) {
			if ( el.localName === 'meta' ) this.meta[ el.getAttribute( 'name' ) ] = el.getAttribute( 'content' );
			if ( el.localName === 'component' ) this.components.push( { name: el.getAttribute( 'name' ), level: + el.getAttribute( 'level' ) } );
		}
		const sceneEl = root.getElementsByTagName( 'Scene' )[ 0 ];
		if ( ! sceneEl ) throw new Error( 'X3D: no Scene' );
		this.root = new X3DNode( 'Scene', '' );
		this._routeEls = [];
		this._parseChildren( sceneEl, this.root );
		for ( const el of this._routeEls ) this._addRoute( el );
		this.stats.timings_ms.parse = + ( performance.now() - t0 ).toFixed( 1 );
		return this;
	}
	_parseChildren( el, node ) {
		for ( const c of el.children ) {
			const tag = c.localName;
			if ( tag === 'ROUTE' ) { this._routeEls.push( c ); continue; }
			if ( tag === 'IS' || tag === 'connect' ) continue;
			const child = this._parseNode( c );
			if ( ! child ) continue;
			let field = c.getAttribute( 'containerField' ) || child.spec.cf || 'children';
			let ft = node.fieldType( field );
			if ( ! ft ) { // tolerate a wrong containerField by falling back to the node's default
				const alt = child.spec.cf; if ( alt && node.fieldType( alt ) ) { field = alt; ft = node.fieldType( alt ); } else { this.stats.unknown_fields.push( node.type + '.' + field + '<-' + child.type ); continue; }
			}
			if ( ft === MFNode ) node.f[ field ].push( child ); else if ( ft === SFNode ) node.f[ field ] = child;
		}
	}
	_parseNode( el ) {
		const tag = el.localName;
		const use = el.getAttribute( 'USE' );
		if ( use ) {
			const n = this.defs.get( use );
			if ( ! n ) { this.stats.unknown_fields.push( 'USE of undefined DEF ' + use ); return null; }
			n.useCount ++;
			return n;
		}
		const spec = NODE_SPECS[ tag ];
		if ( ! spec ) return null;
		const node = new X3DNode( tag, el.getAttribute( 'DEF' ) );
		this.nodes.push( node );
		this.stats.parsed_by_type[ tag ] = ( this.stats.parsed_by_type[ tag ] || 0 ) + 1;
		if ( node.def ) this.defs.set( node.def, node );
		for ( const a of el.attributes ) {
			const name = a.name;
			if ( name === 'DEF' || name === 'USE' || name === 'containerField' || name === 'class' || name === 'id' || name === 'style' ) continue;
			const fs = spec.fields[ name ];
			if ( ! fs ) { this.stats.unknown_fields.push( tag + '.' + name ); continue; }
			node.f[ name ] = parseValue( fs[ 0 ], a.value );
		}
		this._parseChildren( el, node );
		switch ( tag ) {
			case 'TimeSensor': this.timeSensors.push( node ); break;
			case 'PositionInterpolator': case 'OrientationInterpolator': case 'ScalarInterpolator': case 'ColorInterpolator':
				this.interpolators.push( node ); this.stats.keys += node.f.key.length; break;
			case 'Viewpoint': this.viewpoints.push( node ); break;
			case 'NavigationInfo': if ( ! this.navigationInfo ) this.navigationInfo = node; break;
			case 'Background': if ( ! this.background ) this.background = node; break;
			case 'WorldInfo': if ( ! this.worldInfo ) this.worldInfo = node; break;
		}
		return node;
	}
	_addRoute( el ) {
		const fromNode = el.getAttribute( 'fromNode' ), fromField = el.getAttribute( 'fromField' ), toNode = el.getAttribute( 'toNode' ), toField = el.getAttribute( 'toField' );
		this.stats.routes.total ++;
		const from = this.defs.get( fromNode ), to = this.defs.get( toNode );
		const desc = `${fromNode}.${fromField} -> ${toNode}.${toField}`;
		if ( ! from || ! to ) { this.stats.routes.failed.push( desc + ' (unknown node)' ); return; }
		const out = fromField.replace( /_changed$/, '' ), outName = from.spec.fields[ fromField ] ? fromField : out;
		const inName = toField.replace( /^set_/, '' );
		const srcType = from.fieldType( outName ), dstType = to.fieldType( inName ) || ( inName === 'fraction' ? SFFloat : 0 );
		if ( ! srcType || ! dstType ) { this.stats.routes.failed.push( desc + ' (unknown field)' ); return; }
		const route = { from, fromField: outName, to, toField: inName, stamp: - 1, desc };
		if ( ! from.routesOut ) from.routesOut = new Map();
		let list = from.routesOut.get( outName ); if ( ! list ) from.routesOut.set( outName, list = [] );
		list.push( route );
		if ( ! to.animated ) to.animated = new Set();
		to.animated.add( inName );
		this.routes.push( route );
		this.stats.routes.resolved ++;
	}

	// ----- build three.js scene ---------------------------------------------------------------
	build() {
		const t0 = performance.now();
		this._markDynamic();
		this._globalLights = [];
		const ctx = { parent: this.scene, scope: [], dynamic: false, visible: true };
		this.scene.userData.x3d = this.root;
		this._instChildren( this.root.f.children, ctx );
		// static light culling needs world matrices
		this.scene.updateMatrixWorld( true );
		this._assignLights();
		if ( this.options.instancing ) this._batchInstances();
		this._setupBackground();
		this._setupInterpolators();
		this._bindViewpoint( this.viewpoints[ 0 ] || null );
		this._chooseFilm();
		this.stats.lights = this.nodes.filter( n => n.type.endsWith( 'Light' ) ).length;
		this.stats.light_instances = this._lightRecords.length;
		this.stats.materials_x3d = this.nodes.filter( n => n.type === 'PhysicalMaterial' || n.type === 'UnlitMaterial' || n.type === 'Material' ).length;
		this.stats.material_variants = this._materialCache.size;
		this.stats.light_sets = this._lightsNodeCache.size;
		this.stats.geometries = this._geometryCache.size;
		this.stats.textures = this._textureCache.size;
		this.stats.interpolators = this.interpolators.length;
		this.stats.timings_ms.build = + ( performance.now() - t0 ).toFixed( 1 );
		this.update( 0 ); // initial event cascade at t = 0
		return this;
	}
	_markDynamic() {
		// a node is "dynamic" if one of its geometry-affecting fields is a ROUTE target
		for ( const n of this.nodes ) {
			if ( ! n.animated ) continue;
			if ( n.type === 'Transform' && ( n.isAnimated( 'translation' ) || n.isAnimated( 'rotation' ) || n.isAnimated( 'scale' ) || n.isAnimated( 'center' ) || n.isAnimated( 'scaleOrientation' ) ) ) n.dynamic = true;
			if ( n.type === 'Switch' && n.isAnimated( 'whichChoice' ) ) n.dynamic = true;
			if ( n.type.endsWith( 'Light' ) && ( n.isAnimated( 'location' ) || n.isAnimated( 'direction' ) || n.isAnimated( 'radius' ) || n.isAnimated( 'cutOffAngle' ) || n.isAnimated( 'beamWidth' ) || n.isAnimated( 'attenuation' ) ) ) n.dynamic = true;
		}
	}
	_instChildren( children, ctx ) {
		// X3D scoping: lights in a grouping node light everything under that group (siblings before and after)
		const frame = { lights: [] };
		ctx.scope.push( frame );
		for ( const c of children ) if ( c.type === 'DirectionalLight' || c.type === 'PointLight' || c.type === 'SpotLight' ) this._instLight( c, ctx, frame );
		for ( const c of children ) if ( ! ( c.type === 'DirectionalLight' || c.type === 'PointLight' || c.type === 'SpotLight' ) ) this._instNode( c, ctx );
		ctx.scope.pop();
	}
	_instNode( n, ctx ) {
		switch ( n.type ) {
			case 'Transform': case 'Group': case 'Switch': {
				const o = new THREE.Group();
				o.name = n.def || n.type;
				o.userData.x3d = n;
				o.matrixAutoUpdate = false;
				if ( n.type === 'Transform' ) x3dTransformMatrix( n.f, o.matrix );
				o.visible = n.f.visible !== false;
				ctx.parent.add( o );
				n.instances.push( o );
				const save = ctx.parent, saveDyn = ctx.dynamic;
				ctx.parent = o; ctx.dynamic = ctx.dynamic || !! n.dynamic;
				if ( n.type === 'Switch' ) {
					// every choice is instantiated (so set_whichChoice can switch); only whichChoice is visible
					const kids = n.f.children;
					for ( let i = 0; i < kids.length; i ++ ) {
						const holder = new THREE.Group(); holder.name = 'choice' + i; holder.matrixAutoUpdate = false; holder.visible = i === n.f.whichChoice;
						o.add( holder ); ctx.parent = holder;
						this._instChildren( [ kids[ i ] ], ctx );
					}
				} else this._instChildren( n.f.children, ctx );
				ctx.parent = save; ctx.dynamic = saveDyn;
				break;
			}
			case 'Shape': this._instShape( n, ctx ); break;
			case 'Viewpoint': {
				const o = new THREE.Object3D(); o.name = n.def || 'Viewpoint'; o.userData.x3d = n; o.matrixAutoUpdate = false;
				this._setViewpointMatrix( n, o );
				ctx.parent.add( o ); n.instances.push( o );
				break;
			}
			// non-graphical nodes: nothing to instantiate
			default: break;
		}
	}
	_setViewpointMatrix( n, o ) {
		const p = n.f.position; quatFromRotation( n.f.orientation, _q1 ); _v1.x = p[ 0 ]; _v1.y = p[ 1 ]; _v1.z = p[ 2 ]; _v2.x = 1; _v2.y = 1; _v2.z = 1;
		o.matrix.compose( _v1, _q1, _v2 ); o.matrixWorldNeedsUpdate = true;
	}
	_instLight( n, ctx, frame ) {
		const f = n.f;
		let light;
		if ( n.type === 'DirectionalLight' ) { light = new THREE.DirectionalLight(); }
		else if ( n.type === 'PointLight' ) { light = new X3DPointLight(); }
		else { light = new X3DSpotLight(); }
		light.name = n.def || n.type;
		light.userData.x3d = n;
		const rec = { node: n, light, global: f.global === true, dynamic: ctx.dynamic || !! n.dynamic, order: this._lightRecords.length, frame, parent: ctx.parent, maxIntensity: 0 };
		ctx.parent.add( light );
		if ( light.target ) ctx.parent.add( light.target );
		n.instances.push( light );
		this._applyLight( n, light );
		// shadows
		if ( f.shadows ) {
			light.castShadow = true;
			light.shadow.mapSize.set( this.options.shadowMapSize, this.options.shadowMapSize );
			light.shadow.intensity = Math.min( Math.max( f.shadowIntensity, 0 ), 1 );
			light.shadow.bias = - 0.0005; light.shadow.normalBias = 0.02;
			if ( light.shadow.camera.isPerspectiveCamera ) { light.shadow.camera.near = 0.5; light.shadow.camera.far = Math.max( 1, f.radius || 100 ); }
			this.hasShadows = true;
		}
		// the strongest the light ever gets (for static culling and "never on" pruning)
		rec.maxIntensity = f.on ? f.intensity : 0;
		const intensityRoutes = n.isAnimated( 'intensity' ) || n.isAnimated( 'on' ) || n.isAnimated( 'color' );
		rec.animatedIntensity = intensityRoutes;
		if ( rec.global ) this._globalLights.push( rec ); else frame.lights.push( rec );
		this._lightRecords.push( rec );
	}
	_applyLight( n, light ) {
		const f = n.f;
		light.color.setRGB( f.color[ 0 ], f.color[ 1 ], f.color[ 2 ] ); // linear (PhysicalMaterial convention)
		light.intensity = ( f.on ? f.intensity : 0 ) * this.options.lightScale;
		if ( n.type === 'DirectionalLight' ) {
			light.position.set( 0, 0, 0 );
			light.target.position.set( f.direction[ 0 ], f.direction[ 1 ], f.direction[ 2 ] );
		} else {
			light.position.set( f.location[ 0 ], f.location[ 1 ], f.location[ 2 ] );
			light.x3d.radius = f.radius; light.x3d.attenuation.set( f.attenuation[ 0 ], f.attenuation[ 1 ], f.attenuation[ 2 ] );
			light.distance = 0; light.decay = 2;
			if ( n.type === 'SpotLight' ) {
				light.target.position.set( f.location[ 0 ] + f.direction[ 0 ], f.location[ 1 ] + f.direction[ 1 ], f.location[ 2 ] + f.direction[ 2 ] );
				light.x3d.beamWidth = f.beamWidth; light.x3d.cutOffAngle = f.cutOffAngle;
				light.angle = Math.min( Math.max( f.cutOffAngle, 1e-3 ), PI / 2 );
				light.penumbra = Math.min( 1, Math.max( 0, 1 - f.beamWidth / Math.max( f.cutOffAngle, 1e-6 ) ) );
			}
		}
		light.updateMatrix();
		if ( light.target ) light.target.updateMatrix();
	}
	_instShape( n, ctx ) {
		const app = n.f.appearance, geo = n.f.geometry;
		if ( ! geo ) return;
		const g = this._geometry( geo );
		if ( ! g ) return;
		const solid = geo.f.solid !== false;
		const mesh = new THREE.Mesh( g, null );
		mesh.name = n.def || ( geo.def ? 'Shape:' + geo.def : 'Shape' );
		mesh.userData.x3d = n;
		mesh.matrixAutoUpdate = false;
		mesh.castShadow = n.f.castShadow !== false;
		mesh.receiveShadow = true;
		mesh.visible = n.f.visible !== false;
		ctx.parent.add( mesh );
		n.instances.push( mesh );
		// light list in X_ITE order: global lights first (resolved later), then scoped lights outermost first
		const scoped = [];
		for ( const fr of ctx.scope ) for ( const l of fr.lights ) scoped.push( l );
		this._shapeRecords.push( { node: n, mesh, appearance: app, geometry: geo, solid, scoped, dynamic: ctx.dynamic } );
		this.stats.meshes ++;
	}
	_geometry( geo ) {
		let g = this._geometryCache.get( geo );
		if ( g ) return g;
		const f = geo.f;
		switch ( geo.type ) {
			case 'Box': g = buildIndexedFaceSet( boxData( f.size ) ); break;
			case 'Sphere': g = buildIndexedFaceSet( sphereData( Math.abs( f.radius ) ) ); break;
			case 'Cylinder': g = buildIndexedFaceSet( cylinderData( f.radius, f.height, f.top, f.side, f.bottom ) ); break;
			case 'Cone': g = buildIndexedFaceSet( coneData( f.bottomRadius, f.height, f.side, f.bottom ) ); break;
			case 'IndexedFaceSet': {
				if ( ! f.coord ) return null;
				g = buildIndexedFaceSet( { P: f.coord.f.point, coordIndex: f.coordIndex, T: f.texCoord ? f.texCoord.f.point : null, texCoordIndex: f.texCoordIndex,
					N: f.normal ? f.normal.f.vector : null, normalIndex: f.normalIndex, normalPerVertex: f.normalPerVertex, ccw: f.ccw, convex: f.convex, creaseAngle: f.creaseAngle } );
				break;
			}
			case 'IndexedTriangleSet': {
				if ( ! f.coord ) return null;
				const idx = f.index, ci = new Int32Array( ( idx.length / 3 | 0 ) * 4 );
				for ( let i = 0, j = 0; i + 2 < idx.length; i += 3 ) { ci[ j ++ ] = idx[ i ]; ci[ j ++ ] = idx[ i + 1 ]; ci[ j ++ ] = idx[ i + 2 ]; ci[ j ++ ] = - 1; }
				g = buildIndexedFaceSet( { P: f.coord.f.point, coordIndex: ci, T: f.texCoord ? f.texCoord.f.point : null, texCoordIndex: null,
					N: f.normal ? f.normal.f.vector : null, normalIndex: null, normalPerVertex: f.normalPerVertex, ccw: f.ccw, convex: true, creaseAngle: PI } );
				break;
			}
			default: return null;
		}
		g.name = geo.def || geo.type;
		this._geometryCache.set( geo, g );
		this.stats.triangles += g.index.count / 3;
		return g;
	}

	// ----- textures ---------------------------------------------------------------------------
	_texture( texNode ) {
		if ( ! texNode || texNode.type !== 'ImageTexture' ) return null;
		let t = this._textureCache.get( texNode );
		if ( t ) return t;
		t = new THREE.Texture();
		t.name = texNode.def || ( texNode.f.url[ 0 ] || 'ImageTexture' );
		t.colorSpace = THREE.NoColorSpace; // decoded in the shader with gamma 2.2 (X_ITE)
		t.wrapS = texNode.f.repeatS ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
		t.wrapT = texNode.f.repeatT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
		t.anisotropy = this.options.anisotropy;
		t.generateMipmaps = true;
		t.minFilter = this.options.mipFilter === 'nearest' ? THREE.LinearMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
		t.magFilter = THREE.LinearFilter;
		t.flipY = true;
		this._textureCache.set( texNode, t );
		const base = this.options.textureBase || this.url || location.href;
		const urls = texNode.f.url.map( u => new URL( u, new URL( base, location.href ) ).href );
		const p = ( async () => {
			for ( const u of urls ) {
				try {
					const img = await new Promise( ( res, rej ) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; im.onload = () => res( im ); im.onerror = () => rej( new Error( 'load ' + u ) ); im.src = u; } );
					if ( img.decode ) { try { await img.decode(); } catch ( e ) { /* decoded on upload */ } }
					t.image = img; t.needsUpdate = true; t.userData.url = u; t.userData.bytes = 0;
					this._texLoaded = ( this._texLoaded || 0 ) + 1;
					if ( this.options.onProgress ) this.options.onProgress( this._texLoaded, this._textureCache.size, u );
					return t;
				} catch ( e ) { /* try next url */ }
			}
			this.stats.unknown_fields.push( 'texture failed: ' + texNode.f.url.join( ' ' ) );
			return t;
		} )();
		this._texturePromises.push( p );
		return t;
	}

	// ----- materials --------------------------------------------------------------------------
	_materialRecord( matNode ) {
		if ( matNode.rt ) return matNode.rt;
		const f = matNode.f;
		const rt = { meshes: [], variants: [] };
		if ( matNode.type === 'PhysicalMaterial' ) {
			rt.uBase = uniform( new THREE.Color().setRGB( f.baseColor[ 0 ], f.baseColor[ 1 ], f.baseColor[ 2 ] ) );
			rt.uEmissive = uniform( new THREE.Color().setRGB( f.emissiveColor[ 0 ], f.emissiveColor[ 1 ], f.emissiveColor[ 2 ] ) );
			rt.uMetallic = uniform( f.metallic ); rt.uRoughness = uniform( f.roughness );
			rt.uNormalScale = uniform( f.normalScale ); rt.uOcclusion = uniform( f.occlusionStrength );
			rt.uOpacity = uniform( 1 - f.transparency );
		} else if ( matNode.type === 'UnlitMaterial' ) {
			rt.uEmissive = uniform( new THREE.Color().setRGB( f.emissiveColor[ 0 ], f.emissiveColor[ 1 ], f.emissiveColor[ 2 ] ) );
			rt.uOpacity = uniform( 1 - f.transparency );
			rt.uNormalScale = uniform( f.normalScale );
		} else { // Material (Phong): X_ITE shades it in display (sRGB) space; approximated by linearising its colors
			rt.uDiffuse = uniform( new THREE.Color().setRGB( ...[ 0, 1, 2 ].map( i => Math.pow( f.diffuseColor[ i ], 2.2 ) ) ) );
			rt.uEmissive = uniform( new THREE.Color().setRGB( ...[ 0, 1, 2 ].map( i => Math.pow( f.emissiveColor[ i ], 2.2 ) ) ) );
			rt.uSpecular = uniform( new THREE.Color().setRGB( ...[ 0, 1, 2 ].map( i => Math.pow( f.specularColor[ i ], 2.2 ) ) ) );
			rt.uOpacity = uniform( 1 - f.transparency );
			rt.uNormalScale = uniform( f.normalScale );
		}
		// animated transparency or initial transparency -> blended pass
		rt.transparent = f.transparency > 0 || matNode.isAnimated( 'transparency' );
		matNode.rt = rt;
		return rt;
	}
	_material( app, lightsNode, lightsKey, solid ) {
		const key = ( app ? app.id : 0 ) + '|' + lightsKey + '|' + ( solid ? 1 : 2 );
		let m = this._materialCache.get( key );
		if ( m ) return m;
		const matNode = app && app.f.material;
		const tt = app && app.f.textureTransform;
		let uvNode = tslUV();
		if ( tt ) {
			if ( ! tt.rt ) tt.rt = { uMat: uniform( x3dTextureMatrix( tt.f, new THREE.Matrix3() ) ) };
			uvNode = tt.rt.uMat.mul( vec3( tslUV(), 1 ) ).xy;
		}
		const tex = ( node, field ) => { const t = this._texture( node && node.f[ field ] ); return t ? tslTexture( t, uvNode ) : null; };
		if ( ! matNode ) {
			// no material: unlit white (X3D: lighting off); Appearance.texture shows as-is
			m = new THREE.MeshBasicNodeMaterial();
			const t = app ? this._texture( app.f.texture ) : null;
			const S = t ? tslTexture( t, uvNode ).rgb : vec3( 1, 1, 1 );
			m.colorNode = unlitDisplayToLinear( S ).mul( x3dGlobals.unlitGain );
		} else if ( matNode.type === 'PhysicalMaterial' ) {
			const rt = this._materialRecord( matNode );
			m = new THREE.MeshStandardNodeMaterial();
			const base = tex( matNode, 'baseTexture' ) || ( app.f.texture ? ( () => { const t = this._texture( app.f.texture ); return t ? tslTexture( t, uvNode ) : null; } )() : null );
			let color = rt.uBase, alpha = rt.uOpacity;
			if ( base ) { color = color.mul( pow( base.rgb, vec3( 2.2 ) ) ); alpha = alpha.mul( base.a ); }
			m.colorNode = color;
			m.opacityNode = alpha;
			const mr = tex( matNode, 'metallicRoughnessTexture' );
			m.metalnessNode = mr ? rt.uMetallic.mul( mr.b ) : rt.uMetallic;
			m.roughnessNode = mr ? rt.uRoughness.mul( mr.g ) : rt.uRoughness;
			const nt = tex( matNode, 'normalTexture' );
			if ( nt ) m.normalNode = normalMap( nt, vec2( rt.uNormalScale, rt.uNormalScale ) );
			const et = tex( matNode, 'emissiveTexture' );
			m.emissiveNode = ( et ? rt.uEmissive.mul( pow( et.rgb, vec3( 2.2 ) ) ) : rt.uEmissive ).mul( x3dGlobals.emissiveGain );
			const ot = tex( matNode, 'occlusionTexture' );
			if ( ot ) m.aoNode = float( 1 ).add( rt.uOcclusion.mul( ot.r.sub( 1 ) ) );
			m.lightsNode = lightsNode;
			m.transparent = rt.transparent;
		} else if ( matNode.type === 'UnlitMaterial' ) {
			const rt = this._materialRecord( matNode );
			m = new THREE.MeshBasicNodeMaterial();
			const et = tex( matNode, 'emissiveTexture' ) || ( app.f.texture ? ( () => { const t = this._texture( app.f.texture ); return t ? tslTexture( t, uvNode ) : null; } )() : null );
			const S = et ? rt.uEmissive.mul( et.rgb ) : vec3( rt.uEmissive );
			m.colorNode = unlitDisplayToLinear( S ).mul( x3dGlobals.unlitGain );
			m.opacityNode = et ? rt.uOpacity.mul( et.a ) : rt.uOpacity;
			m.transparent = rt.transparent;
			m.userData.x3dUnlit = true;
		} else { // Material
			const rt = this._materialRecord( matNode );
			m = new THREE.MeshPhongNodeMaterial();
			m.userData.x3dClassic = true;
			const dt = tex( matNode, 'diffuseTexture' ) || ( app.f.texture ? ( () => { const t = this._texture( app.f.texture ); return t ? tslTexture( t, uvNode ) : null; } )() : null );
			m.colorNode = dt ? rt.uDiffuse.mul( pow( dt.rgb, vec3( 2.2 ) ) ) : rt.uDiffuse;
			m.opacityNode = dt ? rt.uOpacity.mul( dt.a ) : rt.uOpacity;
			m.emissiveNode = rt.uEmissive;
			m.specularNode = rt.uSpecular;
			m.shininess = Math.max( 1, matNode.f.shininess * 128 );
			const nt = tex( matNode, 'normalTexture' );
			if ( nt ) m.normalNode = normalMap( nt, vec2( rt.uNormalScale, rt.uNormalScale ) );
			m.lightsNode = lightsNode;
			m.transparent = rt.transparent;
		}
		m.side = solid ? THREE.FrontSide : THREE.DoubleSide;
		m.name = ( matNode && matNode.def ) || ( app && app.def ) || ( matNode ? matNode.type : 'Default' );
		if ( m.transparent ) { m.depthWrite = true; }
		this._materialCache.set( key, m );
		if ( matNode && matNode.rt ) matNode.rt.variants.push( m );
		return m;
	}

	// ----- light assignment -------------------------------------------------------------------
	_assignLights() {
		const mode = this.options.lightMode, cap = this.options.maxLightsPerShape;
		const sphere = new THREE.Sphere(), lp = new THREE.Vector3(), ld = new THREE.Vector3(), tmp = new THREE.Vector3();
		const neverOn = ( r ) => ! r.animatedIntensity && r.maxIntensity <= 0;
		for ( const rec of this._lightRecords ) {
			rec.light.updateMatrixWorld( true );
			if ( rec.light.target ) rec.light.target.updateMatrixWorld( true );
			// world scale of the light's coordinate system (distances and radius are local in X3D)
			rec.light.parent.matrixWorld.decompose( _v1, _q1, _v2 );
			const s = ( Math.abs( _v2.x ) + Math.abs( _v2.y ) + Math.abs( _v2.z ) ) / 3 || 1;
			if ( rec.light.x3d ) rec.light.x3d.distScale = 1 / s;
			rec.worldScale = s;
		}
		const reaches = ( rec, shape ) => {
			if ( rec.node.type === 'DirectionalLight' ) return 1;
			if ( rec.dynamic || shape.dynamic ) return 1;
			const g = shape.mesh.geometry;
			sphere.copy( g.boundingSphere ).applyMatrix4( shape.mesh.matrixWorld );
			rec.light.getWorldPosition( lp );
			const dist = lp.distanceTo( sphere.center );
			const R = rec.node.f.radius * rec.worldScale;
			if ( dist - sphere.radius > R ) return 0;
			if ( rec.node.type === 'SpotLight' ) {
				rec.light.target.getWorldPosition( ld ); ld.sub( lp ).normalize();
				if ( dist > sphere.radius ) {
					const ang = Math.acos( Math.min( 1, Math.max( - 1, tmp.subVectors( sphere.center, lp ).normalize().dot( ld ) ) ) );
					const half = Math.asin( Math.min( 1, sphere.radius / dist ) );
					if ( ang - half > rec.node.f.cutOffAngle ) return 0;
				}
			}
			// rough contribution estimate: intensity / d^2
			return ( rec.animatedIntensity ? Math.max( rec.maxIntensity, 1 ) : rec.maxIntensity ) / Math.max( 1, ( dist - sphere.radius ) ** 2 );
		};
		for ( const shape of this._shapeRecords ) {
			let list = this._globalLights.concat( shape.scoped );
			if ( mode === 'cull' ) {
				const scored = [];
				for ( const r of list ) { if ( neverOn( r ) ) continue; const w = reaches( r, shape ); if ( w > 0 ) scored.push( [ r, w ] ); }
				scored.sort( ( a, b ) => b[ 1 ] - a[ 1 ] );
				list = scored.slice( 0, cap ).map( a => a[ 0 ] ).sort( ( a, b ) => a.order - b.order );
			} else {
				list = list.slice( 0, cap );
			}
			const ids = list.map( r => r.light.id );
			const key = ids.join( ',' );
			let ln = this._lightsNodeCache.get( key );
			if ( ! ln ) { ln = tslLights( list.map( r => r.light ) ); this._lightsNodeCache.set( key, ln ); }
			shape.lights = list;
			const m = this._material( shape.appearance, ln, key, shape.solid );
			shape.mesh.material = m;
			const mn = shape.appearance && shape.appearance.f.material;
			if ( mn && mn.rt ) { mn.rt.meshes.push( shape.mesh ); if ( mn.f.transparency >= 0.999 ) shape.mesh.visible = false; }
		}
		this.stats.lights_per_shape = this._shapeRecords.reduce( ( h, s ) => { h[ s.lights.length ] = ( h[ s.lights.length ] || 0 ) + 1; return h; }, {} );
	}

	// ----- instancing of static repeats -------------------------------------------------------
	_batchInstances() {
		// group static meshes that share geometry + material (same light set) under the same parent-agnostic world space
		const groups = new Map();
		for ( const s of this._shapeRecords ) {
			if ( s.dynamic ) continue;
			const m = s.mesh.material;
			if ( m.transparent ) continue; // keep sorting per object
			const matNode = s.appearance && s.appearance.f.material;
			if ( matNode && matNode.isAnimated( 'transparency' ) ) continue;
			const key = s.mesh.geometry.id + ':' + m.id + ':' + ( s.mesh.castShadow ? 1 : 0 );
			let a = groups.get( key ); if ( ! a ) groups.set( key, a = [] ); a.push( s );
		}
		for ( const list of groups.values() ) {
			if ( list.length < 3 ) continue;
			const first = list[ 0 ].mesh;
			const im = new THREE.InstancedMesh( first.geometry, first.material, list.length );
			im.name = 'Instanced:' + ( first.geometry.name || '' );
			im.castShadow = first.castShadow; im.receiveShadow = true;
			im.matrixAutoUpdate = false;
			for ( let i = 0; i < list.length; i ++ ) {
				const s = list[ i ];
				s.mesh.updateWorldMatrix( true, false );
				im.setMatrixAt( i, s.mesh.matrixWorld );
				s.mesh.visible = false; s.mesh.userData.instancedInto = im;
				s.mesh.parent.remove( s.mesh );
				s.instanced = im; s.instanceIndex = i;
			}
			im.instanceMatrix.needsUpdate = true;
			im.computeBoundingSphere();
			this.scene.add( im );
			this.stats.instanced_meshes ++;
			this.stats.instances += list.length;
		}
	}

	// ----- background --------------------------------------------------------------------------
	_setupBackground() {
		const bg = this.background;
		if ( ! bg ) { this.scene.background = new THREE.Color( 0, 0, 0 ); return; }
		const f = bg.f;
		const sky = f.skyColor, skyA = f.skyAngle, gnd = f.groundColor, gndA = f.groundAngle;
		if ( sky.length <= 3 && gnd.length === 0 ) {
			// single color: evaluate the display mapping on the CPU-side constant through the same node
			this.scene.backgroundNode = unlitDisplayToLinear( vec3( sky[ 0 ] || 0, sky[ 1 ] || 0, sky[ 2 ] || 0 ) ).mul( x3dGlobals.unlitGain );
			return;
		}
		const dir = positionWorldDirection;
		const theta = acos( clamp( dir.y, - 1, 1 ) ); // from zenith
		let col = vec3( sky[ 0 ], sky[ 1 ], sky[ 2 ] );
		let prevA = 0;
		for ( let i = 0; i < skyA.length && ( i + 1 ) * 3 < sky.length; i ++ ) {
			const a = skyA[ i ], c = vec3( sky[ ( i + 1 ) * 3 ], sky[ ( i + 1 ) * 3 + 1 ], sky[ ( i + 1 ) * 3 + 2 ] );
			col = mix( col, c, clamp( theta.sub( prevA ).div( Math.max( a - prevA, 1e-6 ) ), 0, 1 ) );
			prevA = a;
		}
		if ( gnd.length >= 3 ) {
			const phi = acos( clamp( dir.y.negate(), - 1, 1 ) ); // from nadir
			let gc = vec3( gnd[ 0 ], gnd[ 1 ], gnd[ 2 ] );
			let pa = 0;
			for ( let i = 0; i < gndA.length && ( i + 1 ) * 3 < gnd.length; i ++ ) {
				const a = gndA[ i ], c = vec3( gnd[ ( i + 1 ) * 3 ], gnd[ ( i + 1 ) * 3 + 1 ], gnd[ ( i + 1 ) * 3 + 2 ] );
				gc = mix( gc, c, clamp( phi.sub( pa ).div( Math.max( a - pa, 1e-6 ) ), 0, 1 ) );
				pa = a;
			}
			// X_ITE: the last ground colour holds from the last groundAngle up to the horizon
			col = select( phi.lessThanEqual( PI / 2 ), gc, col );
		}
		this.scene.backgroundNode = unlitDisplayToLinear( col ).mul( x3dGlobals.unlitGain );
	}

	// ----- viewpoint / camera --------------------------------------------------------------------
	_bindViewpoint( vp ) {
		this.boundViewpoint = vp;
		const nav = this.navigationInfo;
		const avatar = nav ? nav.f.avatarSize : [ 0.25 ];
		let near = ( avatar.length ? avatar[ 0 ] : 0.25 ) / 2;
		let far = nav && nav.f.visibilityLimit > 0 ? nav.f.visibilityLimit : 1e5;
		if ( vp && vp.f.nearDistance > 0 ) near = vp.f.nearDistance;
		if ( vp && vp.f.farDistance > 0 ) far = vp.f.farDistance;
		this.camera.near = Math.max( 1e-4, near ); this.camera.far = far;
		this._fovDirty = true;
		this.syncCamera();
	}
	setAspect( aspect ) { if ( aspect !== this._aspect ) { this._aspect = aspect; this._fovDirty = true; } }
	/** X3D fieldOfView is the angle of the smaller viewport dimension. */
	syncCamera() {
		const vp = this.boundViewpoint, cam = this.camera;
		if ( vp && vp.instances[ 0 ] ) {
			const o = vp.instances[ 0 ];
			o.updateWorldMatrix( true, false );
			o.matrixWorld.decompose( cam.position, cam.quaternion, _v3 );
		}
		const fov = vp ? Math.min( Math.max( vp.f.fieldOfView, 1e-3 ), PI - 1e-3 ) : PI / 4;
		if ( this._fovDirty || fov !== this._lastFov ) {
			const a = this._aspect;
			const vfov = a >= 1 ? fov : 2 * Math.atan( Math.tan( fov / 2 ) / a );
			cam.fov = vfov * 180 / PI; cam.aspect = a; cam.updateProjectionMatrix();
			this._lastFov = fov; this._fovDirty = false;
		}
		cam.updateMatrixWorld( true );
	}

	// ----- events: routes, interpolators, time --------------------------------------------------
	_setupInterpolators() {
		for ( const n of this.interpolators ) {
			const key = n.f.key, kv = n.f.keyValue;
			const k = n.type === 'ScalarInterpolator' ? 1 : n.type === 'OrientationInterpolator' ? 4 : 3;
			const count = Math.min( key.length, kv.length / k | 0 );
			// one shape for every interpolator record (monomorphic loads in _interpolate / _emit)
			const rt = { k, count, last: 0, sv: n.type === 'ScalarInterpolator' ? new Float64Array( 1 ) : null, q: null, hsv: null };
			if ( n.type === 'OrientationInterpolator' ) {
				// pre-convert to quaternions
				rt.q = new Float64Array( count * 4 );
				for ( let i = 0; i < count; i ++ ) { quatFromRotation( kv, _q1, i * 4 ); rt.q[ i * 4 ] = _q1.x; rt.q[ i * 4 + 1 ] = _q1.y; rt.q[ i * 4 + 2 ] = _q1.z; rt.q[ i * 4 + 3 ] = _q1.w; }
			}
			if ( n.type === 'ColorInterpolator' ) {
				rt.hsv = new Float64Array( count * 3 );
				for ( let i = 0; i < count; i ++ ) hsvFromRGB( kv[ i * 3 ], kv[ i * 3 + 1 ], kv[ i * 3 + 2 ], rt.hsv, i * 3 );
			}
			n.rt = rt;
		}
	}
	_interpolate( n, f ) {
		const rt = n.rt, key = n.f.key, cnt = rt.count, out = n.f.value_changed;
		if ( cnt === 0 ) return;
		let i0 = 0, i1 = 0, t = 0;
		if ( f <= key[ 0 ] ) { i0 = i1 = 0; } else if ( f >= key[ cnt - 1 ] ) { i0 = i1 = cnt - 1; } else {
			let i = rt.last;
			if ( ! ( i < cnt - 1 && key[ i ] <= f && f < key[ i + 1 ] ) ) {
				if ( i + 1 < cnt - 1 && key[ i + 1 ] <= f && f < key[ i + 2 ] ) i ++;
				else { let lo = 0, hi = cnt - 1; while ( hi - lo > 1 ) { const mid = ( lo + hi ) >> 1; if ( key[ mid ] <= f ) lo = mid; else hi = mid; } i = lo; }
			}
			rt.last = i; i0 = i; i1 = i + 1;
			const dk = key[ i1 ] - key[ i0 ];
			t = dk > 0 ? ( f - key[ i0 ] ) / dk : 0;
		}
		const kv = n.f.keyValue;
		switch ( n.type ) {
			case 'ScalarInterpolator': { const sv = rt.sv; sv[ 0 ] = kv[ i0 ] + ( kv[ i1 ] - kv[ i0 ] ) * t; n.f.value_changed = sv[ 0 ]; break; }
			case 'PositionInterpolator': for ( let c = 0; c < 3; c ++ ) out[ c ] = kv[ i0 * 3 + c ] + ( kv[ i1 * 3 + c ] - kv[ i0 * 3 + c ] ) * t; break;
			case 'OrientationInterpolator': {
				// shortest-arc slerp written out on the key quaternions (no Quaternion method calls with double arguments)
				const q = rt.q, a0 = i0 * 4, b0 = i1 * 4;
				let x = q[ a0 ], y = q[ a0 + 1 ], z = q[ a0 + 2 ], w = q[ a0 + 3 ];
				if ( i0 !== i1 && t > 0 ) {
					let bx = q[ b0 ], by = q[ b0 + 1 ], bz = q[ b0 + 2 ], bw = q[ b0 + 3 ];
					let cosH = x * bx + y * by + z * bz + w * bw;
					if ( cosH < 0 ) { bx = - bx; by = - by; bz = - bz; bw = - bw; cosH = - cosH; }
					let ka, kb;
					if ( cosH > 0.9995 ) { ka = 1 - t; kb = t; } else {
						const th = Math.acos( cosH ), sn = Math.sin( th );
						ka = Math.sin( ( 1 - t ) * th ) / sn; kb = Math.sin( t * th ) / sn;
					}
					x = x * ka + bx * kb; y = y * ka + by * kb; z = z * ka + bz * kb; w = w * ka + bw * kb;
					const l = Math.sqrt( x * x + y * y + z * z + w * w ); x /= l; y /= l; z /= l; w /= l;
				}
				// SFRotation from the unit quaternion
				const cw = w > 1 ? 1 : w < - 1 ? - 1 : w;
				const sw = Math.sqrt( 1 - cw * cw );
				if ( sw < 1e-9 ) { out[ 0 ] = 0; out[ 1 ] = 0; out[ 2 ] = 1; out[ 3 ] = 0; } else { out[ 0 ] = x / sw; out[ 1 ] = y / sw; out[ 2 ] = z / sw; out[ 3 ] = 2 * Math.acos( cw ); }
				break;
			}
			case 'ColorInterpolator': {
				// HSV interpolation (X_ITE / spec), HSV -> RGB written out
				const h = rt.hsv;
				let ha = h[ i0 * 3 ], hb = h[ i1 * 3 ];
				const sa = h[ i0 * 3 + 1 ], va = h[ i0 * 3 + 2 ], sb = h[ i1 * 3 + 1 ], vb = h[ i1 * 3 + 2 ];
				if ( sa === 0 ) ha = hb; if ( sb === 0 ) hb = ha;
				const range = Math.abs( hb - ha );
				let hh;
				if ( range <= PI ) hh = ha + t * ( hb - ha ); else { const step = ( 2 * PI - range ) * t; hh = ha < hb ? ha - step : ha + step; if ( hh < 0 ) hh += 2 * PI; else if ( hh > 2 * PI ) hh -= 2 * PI; }
				let ss = sa + t * ( sb - sa ), vv = va + t * ( vb - va );
				if ( ss < 0 ) ss = 0; if ( vv < 0 ) vv = 0;
				if ( ss === 0 ) { out[ 0 ] = vv; out[ 1 ] = vv; out[ 2 ] = vv; break; }
				let h2 = hh % ( 2 * PI ); if ( h2 < 0 ) h2 += 2 * PI;
				const nn = h2 * 3 / PI, ii = Math.floor( nn ), ff = nn - ii, p = vv * ( 1 - ss ), qq = vv * ( 1 - ss * ff ), tt = vv * ( 1 - ss * ( 1 - ff ) );
				switch ( ii % 6 ) {
					case 0: out[ 0 ] = vv; out[ 1 ] = tt; out[ 2 ] = p; break;
					case 1: out[ 0 ] = qq; out[ 1 ] = vv; out[ 2 ] = p; break;
					case 2: out[ 0 ] = p; out[ 1 ] = vv; out[ 2 ] = tt; break;
					case 3: out[ 0 ] = p; out[ 1 ] = qq; out[ 2 ] = vv; break;
					case 4: out[ 0 ] = tt; out[ 1 ] = p; out[ 2 ] = vv; break;
					default: out[ 0 ] = vv; out[ 1 ] = p; out[ 2 ] = qq;
				}
				break;
			}
		}
		this._emit( n, 'value_changed' );
	}
	_emit( node, field ) {
		const list = node.routesOut && node.routesOut.get( field );
		if ( ! list ) return;
		const rt = node.rt;
		if ( rt !== null && rt.sv != null && field === 'value_changed' ) {
			// scalar interpolator: the value travels in a Float64Array slot, never as a boxed number
			for ( let i = 0; i < list.length; i ++ ) {
				const r = list[ i ];
				if ( r.stamp === this._stamp ) continue;
				r.stamp = this._stamp;
				this._deliverScalar( r.to, r.toField, rt.sv, node );
			}
			return;
		}
		const v = node.f[ field ];
		for ( let i = 0; i < list.length; i ++ ) {
			const r = list[ i ];
			if ( r.stamp === this._stamp ) continue; // loop breaking: each route fires once per timestamp
			r.stamp = this._stamp;
			this._deliver( r.to, r.toField, v, node );
		}
	}
	_deliver( to, field, v, from ) {
		// interpolator input
		if ( field === 'fraction' && to.rt && to.rt.count !== undefined ) { this._interpolate( to, v ); return; }
		const cur = to.f[ field ];
		if ( cur !== null && typeof cur === 'object' && cur.length !== undefined && typeof v === 'object' ) {
			// copy element-wise; an unchanged value changes nothing downstream, so stop here (saves matrix and uniform work)
			let changed = false;
			const n = ( field === 'rotation' || field === 'orientation' ) ? 4 : Math.min( cur.length, v.length );
			for ( let i = 0; i < n; i ++ ) if ( cur[ i ] !== v[ i ] ) { cur[ i ] = v[ i ]; changed = true; }
			if ( ! changed ) return;
		} else { if ( cur === v ) return; to.f[ field ] = v; }
		this._fieldChanged( to, field, from );
		this._emit( to, field ); // inputOutput fields forward their value (field_changed)
	}
	/** Scalar delivery with named loads/stores per field (no generic keyed access, so no HeapNumber per event). */
	_deliverScalar( to, field, sv, from ) {
		const f = to.f, v = sv[ 0 ];
		switch ( field ) {
			case 'intensity': if ( f.intensity === v ) return; f.intensity = v; break;
			case 'fieldOfView': if ( f.fieldOfView === v ) return; f.fieldOfView = v; break;
			case 'transparency': if ( f.transparency === v ) return; f.transparency = v; break;
			case 'radius': if ( f.radius === v ) return; f.radius = v; break;
			case 'ambientIntensity': if ( f.ambientIntensity === v ) return; f.ambientIntensity = v; break;
			case 'beamWidth': if ( f.beamWidth === v ) return; f.beamWidth = v; break;
			case 'cutOffAngle': if ( f.cutOffAngle === v ) return; f.cutOffAngle = v; break;
			case 'metallic': if ( f.metallic === v ) return; f.metallic = v; break;
			case 'roughness': if ( f.roughness === v ) return; f.roughness = v; break;
			case 'normalScale': if ( f.normalScale === v ) return; f.normalScale = v; break;
			case 'occlusionStrength': if ( f.occlusionStrength === v ) return; f.occlusionStrength = v; break;
			case 'shininess': if ( f.shininess === v ) return; f.shininess = v; break;
			case 'shadowIntensity': if ( f.shadowIntensity === v ) return; f.shadowIntensity = v; break;
			case 'fraction': if ( to.rt && to.rt.count !== undefined ) { this._interpolate( to, v ); return; } f.fraction = v; break;
			default: if ( f[ field ] === v ) return; f[ field ] = v; // rare fields (e.g. TextureTransform.rotation)
		}
		this._fieldChanged( to, field, from );
		this._emit( to, field );
	}
	_fieldChanged( n, field, from ) {
		const f = n.f;
		switch ( n.type ) {
			case 'Transform': {
				const inst = n.instances;
				if ( inst.length ) { x3dTransformMatrix( f, inst[ 0 ].matrix ); inst[ 0 ].matrixWorldNeedsUpdate = true; for ( let i = 1; i < inst.length; i ++ ) { inst[ i ].matrix.copy( inst[ 0 ].matrix ); inst[ i ].matrixWorldNeedsUpdate = true; } }
				break;
			}
			case 'Group': case 'Transform$': break;
			case 'Switch': {
				if ( field === 'whichChoice' ) for ( let k = 0; k < n.instances.length; k ++ ) { const o = n.instances[ k ]; for ( let i = 0; i < o.children.length; i ++ ) o.children[ i ].visible = i === f.whichChoice; }
				break;
			}
			case 'Viewpoint': {
				if ( field === 'position' || field === 'orientation' ) for ( let k = 0; k < n.instances.length; k ++ ) this._setViewpointMatrix( n, n.instances[ k ] );
				break;
			}
			case 'DirectionalLight': case 'PointLight': case 'SpotLight': {
				const scale = this.options.lightScale;
				for ( let k = 0; k < n.instances.length; k ++ ) {
					const l = n.instances[ k ];
					if ( field === 'intensity' || field === 'on' ) l.intensity = ( f.on ? f.intensity : 0 ) * scale;
					else if ( field === 'color' ) { const c = l.color, k = f.color; c.r = k[ 0 ]; c.g = k[ 1 ]; c.b = k[ 2 ]; }
					else this._applyLight( n, l );
				}
				break;
			}
			case 'PhysicalMaterial': case 'UnlitMaterial': case 'Material': {
				const rt = n.rt; if ( ! rt ) break;
				switch ( field ) {
					case 'baseColor': if ( rt.uBase ) { const c = rt.uBase.value, k = f.baseColor; c.r = k[ 0 ]; c.g = k[ 1 ]; c.b = k[ 2 ]; } break;
					case 'emissiveColor':
						if ( n.type === 'Material' ) rt.uEmissive.value.setRGB( Math.pow( f.emissiveColor[ 0 ], 2.2 ), Math.pow( f.emissiveColor[ 1 ], 2.2 ), Math.pow( f.emissiveColor[ 2 ], 2.2 ) );
						else { const c = rt.uEmissive.value, k = f.emissiveColor; c.r = k[ 0 ]; c.g = k[ 1 ]; c.b = k[ 2 ]; }
						break;
					case 'diffuseColor': rt.uDiffuse && rt.uDiffuse.value.setRGB( Math.pow( f.diffuseColor[ 0 ], 2.2 ), Math.pow( f.diffuseColor[ 1 ], 2.2 ), Math.pow( f.diffuseColor[ 2 ], 2.2 ) ); break;
					case 'specularColor': rt.uSpecular && rt.uSpecular.value.setRGB( Math.pow( f.specularColor[ 0 ], 2.2 ), Math.pow( f.specularColor[ 1 ], 2.2 ), Math.pow( f.specularColor[ 2 ], 2.2 ) ); break;
					case 'metallic': rt.uMetallic && ( rt.uMetallic.value = f.metallic ); break;
					case 'roughness': rt.uRoughness && ( rt.uRoughness.value = f.roughness ); break;
					case 'normalScale': rt.uNormalScale && ( rt.uNormalScale.value = f.normalScale ); break;
					case 'occlusionStrength': rt.uOcclusion && ( rt.uOcclusion.value = f.occlusionStrength ); break;
					case 'transparency': {
						rt.uOpacity.value = 1 - f.transparency;
						const vis = f.transparency < 0.999;
						for ( let i = 0; i < rt.meshes.length; i ++ ) rt.meshes[ i ].visible = vis;
						break;
					}
				}
				break;
			}
			case 'TextureTransform': if ( n.rt ) x3dTextureMatrix( f, n.rt.uMat.value ); break;
			case 'TimeSensor': break;
			default: break;
		}
	}
	_chooseFilm() {
		let film = this.defs.get( 'Film' );
		if ( ! film || film.type !== 'TimeSensor' ) film = this.timeSensors.reduce( ( a, b ) => ( ! a || b.f.cycleInterval > a.f.cycleInterval ) ? b : a, null );
		const self = this;
		this.film = {
			node: film,
			name: film ? film.def : '',
			length: film ? film.f.cycleInterval : 0,
			time: 0,
			fraction: 0,
			playing: true,
			rate: 1,
			targets: film && film.routesOut && film.routesOut.get( 'fraction_changed' ) ? film.routesOut.get( 'fraction_changed' ).length : 0,
			setTime( t ) { self.setTime( t ); },
			setFraction( f ) { self.setFraction( f ); },
		};
	}
	/** Scrub: send one fraction to every target of Film.fraction_changed (exactly what X_ITE does with set_fraction). */
	setFraction( fr ) {
		const film = this.film && this.film.node;
		const L = film ? film.f.cycleInterval : 1;
		const f = Math.min( Math.max( fr, 0 ), 1 );
		this._stamp ++;
		this.film.fraction = f;
		this.film.time = f * L;
		this.time = this.film.time;
		if ( film ) {
			film.f.fraction_changed = f; film.f.time = this.time;
			this._emit( film, 'fraction_changed' );
		}
		this._evaluateOtherSensors( film );
		this.syncCamera();
	}
	/** Set the film clock (seconds). Every TimeSensor is evaluated against it. */
	setTime( t ) {
		const film = this.film && this.film.node;
		if ( film && film.f.enabled ) {
			const L = film.f.cycleInterval;
			let f;
			if ( film.f.loop ) { f = ( ( t % L ) + L ) % L / L; } else f = Math.min( Math.max( t / L, 0 ), 1 );
			this.setFraction( f );
			this.time = t;
		} else { this._stamp ++; this.time = t; this._evaluateOtherSensors( null ); this.syncCamera(); }
	}
	/** Advance the clock by dt seconds (playback). */
	update( dt = 0 ) {
		if ( ! this.film ) { this.syncCamera(); return; }
		if ( this.film.playing ) this.setTime( this.time + dt * this.film.rate ); else this.setTime( this.time );
	}
	_evaluateOtherSensors( film ) {
		for ( let i = 0; i < this.timeSensors.length; i ++ ) {
			const ts = this.timeSensors[ i ];
			if ( ts === film || ! ts.f.enabled ) continue;
			const f = ts.f, t = this.time, L = f.cycleInterval > 0 ? f.cycleInterval : 1;
			if ( t < f.startTime ) continue;
			let fr;
			if ( f.loop ) fr = ( ( t - f.startTime ) % L ) / L;
			else { if ( t > f.startTime + L ) { if ( f.isActive ) { f.isActive = false; f.fraction_changed = 1; this._emit( ts, 'fraction_changed' ); } continue; } fr = ( t - f.startTime ) / L; f.isActive = true; }
			f.fraction_changed = fr; f.time = t;
			this._emit( ts, 'fraction_changed' );
		}
	}

	// ----- public helpers ----------------------------------------------------------------------
	getNode( def ) { return this.defs.get( def ) || null; }
	/** Every instantiated light: { node, light (three object), global, maxIntensity, animatedIntensity, worldScale }. */
	get lightRecords() { return this._lightRecords; }
	texturesReady() { return Promise.all( this._texturePromises ); }
	/** Static counts that an engine HUD can show. */
	summary() {
		const s = this.stats;
		return { profile: this.profile, version: this.version, shapes: s.meshes, lights: s.lights, light_instances: s.light_instances, materials: s.materials_x3d,
			material_variants: s.material_variants, textures: s.textures, interpolators: s.interpolators, routes: s.routes.resolved, keys: s.keys,
			triangles: s.triangles, film_s: this.film ? this.film.length : 0 };
	}
	dispose() {
		for ( const g of this._geometryCache.values() ) g.dispose();
		for ( const m of this._materialCache.values() ) m.dispose();
		for ( const t of this._textureCache.values() ) t.dispose();
	}
}

/** Load and build an X3D file. Resolves when the scene graph is built (and textures loaded unless waitForTextures=false). */
export async function load( url, options = {} ) {
	const t0 = performance.now();
	if ( options.renderer ) registerX3DLights( options.renderer );
	const res = await fetch( url );
	if ( ! res.ok ) throw new Error( `X3D fetch ${url}: HTTP ${res.status}` );
	const text = await res.text();
	const tf = performance.now();
	const absUrl = new URL( url, location.href ).href;
	const world = new X3DWorld( options ).parse( text, absUrl ).build();
	world.stats.bytes = text.length;
	world.stats.timings_ms.fetch = + ( tf - t0 ).toFixed( 1 );
	if ( world.options.waitForTextures ) { const tt = performance.now(); await world.texturesReady(); world.stats.timings_ms.textures = + ( performance.now() - tt ).toFixed( 1 ); }
	world.stats.timings_ms.total = + ( performance.now() - t0 ).toFixed( 1 );
	return world;
}

/** Parse from a string (no fetch). */
export function parse( text, options = {} ) {
	if ( options.renderer ) registerX3DLights( options.renderer );
	return new X3DWorld( options ).parse( text, options.url || location.href ).build();
}

export default { load, parse, X3DWorld, registerX3DLights, buildIndexedFaceSet, neutralToneMap, neutralInverse, unlitDisplayToLinear, x3dGlobals, NODE_SPECS, CONTRACT_NODES, LOADER_VERSION };
