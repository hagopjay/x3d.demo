/* The lens: the original page's post pass (bloom, then ACES, gamma, vignette, film grain), run over X_ITE's
   frame. X3D has no post-processing node and X_ITE renders into an 8-bit buffer, so the scene's shaders tone-map
   each fragment with the original's own curve (display(): ACES of 1.32 x radiance, gamma 2.2). This pass inverts
   that curve exactly (it is monotone), recovers scene-linear light, and then runs the original's bloom chain and
   composite unchanged: threshold 0.55 on the first half-size level, four levels, the same 5-tap blur, weights
   .3 .3 .25 .25, bloom x glow x 0.7 added before the tone curve. What it cannot recover is light the 8-bit frame
   clipped (display values of 1), so bloom from the very brightest highlights is slightly weaker. Toggle it off to
   see X_ITE's frame as it is. */
(function (global) {
  'use strict';
  const fullVS = `#version 300 es
precision highp float;out vec2 vUV;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUV=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
  const DECODE = `#version 300 es
precision highp float;in vec2 vUV;uniform sampler2D uTex;out vec4 outColor;
// inverse of display(): y = pow(ACES(1.32 x), 1/2.2) -> x
vec3 undisplay(vec3 y){vec3 v=min(pow(clamp(y,0.,1.),vec3(2.2)),vec3(.9995));const float A=2.51,B=.03,C=2.43,D=.59,E=.14;
 vec3 qa=A-v*C,qb=B-v*D,qc=-v*E;vec3 x=(-qb+sqrt(qb*qb-4.*qa*qc))/(2.*qa);return x/1.32;}
void main(){outColor=vec4(undisplay(texture(uTex,vec2(vUV.x,vUV.y)).rgb),1.);}`;
  // The original's down and blur programs, verbatim.
  const DOWN = `#version 300 es
precision highp float;in vec2 vUV;uniform sampler2D uTex;uniform vec2 uTexel;uniform float uThreshold;out vec4 outColor;void main(){vec3 c=texture(uTex,vUV).rgb*.2;c+=(texture(uTex,vUV+uTexel*vec2(1.,1.)).rgb+texture(uTex,vUV+uTexel*vec2(-1.,1.)).rgb+texture(uTex,vUV+uTexel*vec2(1.,-1.)).rgb+texture(uTex,vUV-uTexel).rgb)*.2;float b=max(c.r,max(c.g,c.b));c*=max(b-uThreshold,0.)/max(b,.0001);outColor=vec4(c,1.);}`;
  const BLUR = `#version 300 es
precision highp float;in vec2 vUV;uniform sampler2D uTex;uniform vec2 uDirection;out vec4 outColor;void main(){vec3 c=texture(uTex,vUV).rgb*.227027;c+=(texture(uTex,vUV+uDirection*1.384615).rgb+texture(uTex,vUV-uDirection*1.384615).rgb)*.316216;c+=(texture(uTex,vUV+uDirection*3.230769).rgb+texture(uTex,vUV-uDirection*3.230769).rgb)*.07027;outColor=vec4(c,1.);}`;
  // The original's post composite, minus FXAA (X_ITE multisamples) and screen-space AO (the scene computes AO
  // from the true height function).
  const POST = `#version 300 es
precision highp float;in vec2 vUV;uniform sampler2D uTex,uBloom0,uBloom1,uBloom2,uBloom3;uniform float uGlow,uTime,uGrain,uVignette;out vec4 outColor;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
void main(){vec3 c=texture(uTex,vUV).rgb;vec3 bloom=texture(uBloom0,vUV).rgb*.3+texture(uBloom1,vUV).rgb*.3+texture(uBloom2,vUV).rgb*.25+texture(uBloom3,vUV).rgb*.25;c+=bloom*uGlow*.7;c=aces(c*1.32);c=pow(c,vec3(1./2.2));vec2 q=vUV*(1.-vUV);float vig=pow(clamp(q.x*q.y*16.,0.,1.),.18);c*=mix(1.,.68+.32*vig,uVignette);c+=(hash(gl_FragCoord.xy+floor(uTime*24.))-.5)*.012*uGrain;outColor=vec4(c,1.);}`;

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw Error('the lens needs WebGL 2');
    const hdr = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('lens shader: ' + gl.getShaderInfoLog(s)); return s; }
    function program(fs) { const p = gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, fullVS)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p)); const loc = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); loc[a.name] = gl.getUniformLocation(p, a.name); } return { p, loc }; }
    const P = { decode: program(DECODE), down: program(DOWN), blur: program(BLUR), post: program(POST) };
    const source = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, source); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    function target(w, h) {
      const t = { tex: gl.createTexture(), fb: gl.createFramebuffer(), w, h };
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.texImage2D(gl.TEXTURE_2D, 0, hdr ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      return t;
    }
    let W = 0, H = 0, S = 1, linear = null, pre = [], bloom = [];
    // Under supersampling (scale s device pixels per CSS pixel) the bloom pyramid starts log2(s) levels lower,
    // so the glow keeps the original's size on screen (a 2x canvas otherwise halves every bloom radius).
    function resize(w, h, s) {
      if (w === W && h === H && s === S) return;
      for (const t of [linear, ...pre, ...bloom.flat()]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      W = w; H = h; S = s; canvas.width = w; canvas.height = h; linear = target(w, h); bloom = []; pre = [];
      for (let k = 1; k <= Math.round(Math.log2(Math.max(1, s))); k++) pre.push(target(Math.max(2, Math.floor(w / 2 ** k)), Math.max(2, Math.floor(h / 2 ** k))));
      const base = 2 ** pre.length;
      for (let i = 0; i < 4; i++) { const bw = Math.max(2, Math.floor(w / base / 2 ** (i + 1))), bh = Math.max(2, Math.floor(h / base / 2 ** (i + 1))); bloom.push([target(bw, bh), target(bw, bh)]); }
    }
    function bind(t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null); gl.viewport(0, 0, t ? t.w : W, t ? t.h : H); }
    function tex(loc, t, unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); }
    function draw(t) { bind(t); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    // Read X_ITE's frame (call in the same animation frame, after X_ITE has drawn) and draw the lens.
    function render(from, opts) {
      const w = from.width, h = from.height; if (!w || !h) return;
      resize(w, h, opts.scale || 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.bindTexture(gl.TEXTURE_2D, source); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, from);
      gl.useProgram(P.decode.p); tex(P.decode.loc.uTex, source, 0); draw(linear);
      let prev = linear;
      for (const t of pre) {        // plain 2x reductions (no threshold) down to CSS resolution
        gl.useProgram(P.down.p); tex(P.down.loc.uTex, prev.tex, 0); gl.uniform2f(P.down.loc.uTexel, 1 / prev.w, 1 / prev.h); gl.uniform1f(P.down.loc.uThreshold, 0); draw(t); prev = t;
      }
      for (let i = 0; i < 4; i++) {
        const [a, b] = bloom[i];
        gl.useProgram(P.down.p); tex(P.down.loc.uTex, prev.tex, 0); gl.uniform2f(P.down.loc.uTexel, 1 / prev.w, 1 / prev.h); gl.uniform1f(P.down.loc.uThreshold, i === 0 ? .55 : 0); draw(a);
        gl.useProgram(P.blur.p); tex(P.blur.loc.uTex, a.tex, 0); gl.uniform2f(P.blur.loc.uDirection, 1 / a.w, 0); draw(b);
        tex(P.blur.loc.uTex, b.tex, 0); gl.uniform2f(P.blur.loc.uDirection, 0, 1 / a.h); draw(a);
        prev = a;
      }
      gl.useProgram(P.post.p); tex(P.post.loc.uTex, linear.tex, 0);
      for (let i = 0; i < 4; i++) tex(P.post.loc['uBloom' + i], bloom[i][0].tex, i + 1);
      gl.uniform1f(P.post.loc.uGlow, opts.glow); gl.uniform1f(P.post.loc.uTime, opts.time); gl.uniform1f(P.post.loc.uGrain, opts.grain ? 1 : 0); gl.uniform1f(P.post.loc.uVignette, 1);
      draw(null);
    }
    return { render, hdr, gl, canvas };
  }
  global.ManifoldLens = Object.freeze({ create });
})(window);
