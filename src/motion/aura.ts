/**
 * 余温光晕 — a slow, warm pool of light drawn with a single fragment shader.
 * Domain-warped noise keeps the edges alive; the whole thing breathes at ~0.1 Hz
 * and leans a little toward the pointer. It renders at half resolution (it is
 * all soft gradients), pauses off-screen and in background tabs, and falls back
 * to a CSS gradient where WebGL or motion is unavailable.
 */

const vertex = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const fragment = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec2 c;uniform vec3 g1;uniform vec3 g2;uniform vec3 g3;uniform float k;uniform float s;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1.,0.)),u.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
void main(){
  vec2 p=(gl_FragCoord.xy-c*r)/(min(r.x,r.y)*s);
  float T=t*.045;
  vec2 q=vec2(fbm(p*1.5+T),fbm(p*1.5-T+3.7));
  float m=fbm(p*1.15+q*1.5+T*.7);
  float d=length(p*vec2(1.,1.18)+(q-.5)*.42);
  float b=.92+.08*sin(t*.62);
  float core=smoothstep(.72*b,0.,d);
  float halo=smoothstep(1.35,.05,d);
  float a=clamp((core*.8+halo*.38)*(.6+.6*m),0.,1.)*k;
  vec3 col=mix(g1,g2,smoothstep(.25,.85,m));
  col=mix(col,g3,core*.65);
  gl_FragColor=vec4(col*a,a);
}`;

interface AuraOptions {
  /** Where the light rests, as a fraction of the canvas (x from left, y from top). */
  anchor: [number, number];
  /** How far the light leans toward the pointer (0 = not at all). */
  follow?: number;
  /** Overall brightness, 0–1. */
  intensity?: number;
  /** Size of the pool relative to the short side. */
  spread?: number;
}

const hex = (value: string): [number, number, number] => {
  const clean = value.trim().replace('#', '');
  const full = clean.length === 3 ? [...clean].map(char => char + char).join('') : clean;
  const number = Number.parseInt(full, 16);
  return [(number >> 16 & 255) / 255, (number >> 8 & 255) / 255, (number & 255) / 255];
};

export function mountAura(canvas: HTMLCanvasElement, options: AuraOptions): { setIntensity: (value: number) => void; setAnchor: (x: number, y: number) => void } {
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const controls = {
    setIntensity: (value: number) => { intensity = value; },
    setAnchor: (x: number, y: number) => { anchor = [x, y]; canvas.style.setProperty('--ax', `${x * 100}%`); canvas.style.setProperty('--ay', `${y * 100}%`); },
  };
  let anchor = options.anchor;
  let intensity = options.intensity ?? 1;
  controls.setAnchor(anchor[0], anchor[1]);

  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) { canvas.classList.add('is-static'); return controls; }

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { canvas.classList.add('is-static'); return controls; }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const u = { r: uniform('r'), t: uniform('t'), c: uniform('c'), g1: uniform('g1'), g2: uniform('g2'), g3: uniform('g3'), k: uniform('k'), s: uniform('s') };

  const readColours = () => {
    const style = getComputedStyle(canvas);
    gl.uniform3fv(u.g1, hex(style.getPropertyValue('--glow-1') || '#f7b79a'));
    gl.uniform3fv(u.g2, hex(style.getPropertyValue('--glow-2') || '#f0a0a8'));
    gl.uniform3fv(u.g3, hex(style.getPropertyValue('--glow-3') || '#ffe6c7'));
    strength = Number.parseFloat(style.getPropertyValue('--glow-strength')) || 1;
  };
  let strength = 1;
  readColours();
  gl.uniform1f(u.s, options.spread ?? 1);

  let width = 0;
  let height = 0;
  const resize = () => {
    const scale = Math.min(devicePixelRatio || 1, 1.5) * .5;
    width = Math.max(1, Math.round(canvas.clientWidth * scale));
    height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    gl.uniform2f(u.r, width, height);
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  // The light leans toward the pointer, lerped so it never snaps.
  const follow = options.follow ?? 0;
  let target: [number, number] = [anchor[0], anchor[1]];
  let current: [number, number] = [anchor[0], anchor[1]];
  if (follow > 0) {
    addEventListener('pointermove', event => {
      const bounds = canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      target = [anchor[0] + (x - anchor[0]) * follow, anchor[1] + (y - anchor[1]) * follow];
    }, { passive: true });
  }

  let visible = false;
  let frame = 0;
  const start = performance.now() - Math.random() * 20_000;
  const draw = (now: number) => {
    frame = 0;
    if (follow <= 0) target = [anchor[0], anchor[1]];
    current = [current[0] + (target[0] - current[0]) * .045, current[1] + (target[1] - current[1]) * .045];
    gl.uniform2f(u.c, current[0], 1 - current[1]);
    gl.uniform1f(u.t, calm.matches ? 8 : (now - start) / 1000);
    gl.uniform1f(u.k, intensity * strength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (visible && !calm.matches && document.visibilityState === 'visible') frame = requestAnimationFrame(draw);
  };
  const wake = () => { if (!frame) frame = requestAnimationFrame(draw); };

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) { canvas.classList.add('is-on'); wake(); }
  }, { rootMargin: '10% 0px' }).observe(canvas);
  document.addEventListener('visibilitychange', wake);
  new MutationObserver(() => { readColours(); wake(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  calm.addEventListener('change', wake);
  return controls;
}
