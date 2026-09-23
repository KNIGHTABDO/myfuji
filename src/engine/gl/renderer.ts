import { FRAG, VERT } from './shaders';

export interface RenderUniforms {
  wb: [number, number, number];
  ev: number;
  compress: number;
  shadowLift: number;
  clarity: number;
  subjectLift: number;
  shoulder: [number, number];
  halation: number;
  halTint: [number, number, number];
  sharp: number;
  intensity: number;
  skin: boolean;
  grain: number;
  grainSize: number;
  grainChroma: number;
  vignette: number;
  leak: number;
  leakSeed: number;
  crop: [number, number, number, number];
}

type Loc = WebGLUniformLocation | null;

/** WebGL2 film pipeline. One instance owns one canvas and its textures. */
export class FilmRenderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private loc: Record<string, Loc> = {};
  private src: WebGLTexture | null = null;
  private aux: WebGLTexture | null = null;
  private lut: WebGLTexture | null = null;
  private lutSkin: WebGLTexture | null = null;
  private lutSize = 2;
  private fbo: WebGLFramebuffer | null = null;
  private fboTex: WebGLTexture | null = null;
  private fboSize = [0, 0];
  width = 0;
  height = 0;
  readonly maxTexture: number;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const vs = this.shader(gl.VERTEX_SHADER, VERT), fs = this.shader(gl.FRAGMENT_SHADER, FRAG);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Shader link failed: ' + gl.getProgramInfoLog(p));
    this.prog = p;
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i)!; this.loc[u.name] = gl.getUniformLocation(p, u.name); }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.lut = this.make3D(); this.lutSkin = this.make3D();
  }

  private shader(type: number, code: string) {
    const gl = this.gl, s = gl.createShader(type)!;
    gl.shaderSource(s, code); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(s));
    return s;
  }
  private make3D() {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    return t;
  }

  /** Upload the working image. It is sampled with mipmaps so a downscaled preview never aliases. */
  setImage(source: TexImageSource, w: number, h: number) {
    const gl = this.gl;
    if (this.src) gl.deleteTexture(this.src);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.SRGB8_ALPHA8, w, h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.src = t; this.width = w; this.height = h;
  }

  setAux(data: Uint16Array, w: number, h: number) {
    const gl = this.gl;
    if (!this.aux) {
      this.aux = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.aux);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.aux);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, data);
  }

  setLuts(main: Uint16Array, skin: Uint16Array, size: number) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_3D, this.lut);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, size, size, size, 0, gl.RGBA, gl.HALF_FLOAT, main);
    gl.bindTexture(gl.TEXTURE_3D, this.lutSkin);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, size, size, size, 0, gl.RGBA, gl.HALF_FLOAT, skin);
    this.lutSize = size;
  }

  get ready() { return !!(this.src && this.aux); }

  private bind(u: RenderUniforms, view: [number, number, number, number], outW: number, outH: number, flipY: boolean, split: number, original: boolean) {
    const gl = this.gl, L = this.loc;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.src); gl.uniform1i(L.uSrc, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.aux); gl.uniform1i(L.uAux, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, this.lut); gl.uniform1i(L.uLut, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_3D, this.lutSkin); gl.uniform1i(L.uLutSkin, 3);
    gl.uniform1f(L.uLutSize, this.lutSize);
    gl.uniform4f(L.uView, view[0], view[1], view[2], view[3]);
    gl.uniform4f(L.uCrop, ...u.crop);
    gl.uniform2f(L.uFull, this.width, this.height);
    const scale = ((view[2] - view[0]) * this.width) / outW;
    gl.uniform1f(L.uScale, scale);
    gl.uniform1f(L.uFlipY, flipY ? 1 : 0);
    gl.uniform3f(L.uWb, ...u.wb);
    gl.uniform1f(L.uEv, u.ev);
    gl.uniform1f(L.uCompress, u.compress);
    gl.uniform1f(L.uShadowLift, u.shadowLift);
    gl.uniform1f(L.uClarity, u.clarity);
    gl.uniform1f(L.uSubjectLift, u.subjectLift);
    gl.uniform2f(L.uShoulder, ...u.shoulder);
    gl.uniform1f(L.uHalation, u.halation);
    gl.uniform3f(L.uHalTint, ...u.halTint);
    gl.uniform1f(L.uSharp, u.sharp);
    gl.uniform1f(L.uIntensity, u.intensity);
    gl.uniform1f(L.uSkin, u.skin ? 1 : 0);
    gl.uniform1f(L.uGrain, u.grain);
    gl.uniform1f(L.uGrainSize, u.grainSize);
    gl.uniform1f(L.uGrainChroma, u.grainChroma);
    gl.uniform1f(L.uVignette, u.vignette);
    gl.uniform1f(L.uLeak, u.leak);
    gl.uniform1f(L.uLeakSeed, u.leakSeed);
    gl.uniform1f(L.uSplit, split);
    gl.uniform1f(L.uOriginal, original ? 1 : 0);
  }

  /** Draw a region of the image into the canvas. */
  render(u: RenderUniforms, view: [number, number, number, number], outW: number, outH: number, opts: { split?: number; original?: boolean } = {}) {
    if (!this.ready) return;
    const gl = this.gl;
    if (this.canvas.width !== outW || this.canvas.height !== outH) { this.canvas.width = outW; this.canvas.height = outH; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outW, outH);
    // Canvas row 0 is the top of the image, GL row 0 is the bottom.
    this.bind(u, view, outW, outH, true, opts.split ?? -1, !!opts.original);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private ensureFbo(w: number, h: number) {
    const gl = this.gl;
    if (this.fbo && this.fboSize[0] === w && this.fboSize[1] === h) return;
    if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.fboTex); }
    this.fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    this.fboSize = [w, h];
  }

  /**
   * Render a crop at an output size into RGBA bytes (top row first), in tiles,
   * so exports can exceed the canvas/drawing-buffer limits.
   */
  async renderToPixels(u: RenderUniforms, crop: [number, number, number, number], outW: number, outH: number, onTile?: (done: number, total: number) => void): Promise<ImageData> {
    const gl = this.gl;
    const T = Math.min(2048, this.maxTexture);
    this.ensureFbo(T, T);
    const out = new ImageData(outW, outH);
    const tilesX = Math.ceil(outW / T), tilesY = Math.ceil(outH / T), total = tilesX * tilesY;
    const buf = new Uint8Array(T * T * 4);
    let done = 0;
    for (let ty = 0; ty < tilesY; ty++)
      for (let tx = 0; tx < tilesX; tx++) {
        const x0 = tx * T, y0 = ty * T, w = Math.min(T, outW - x0), h = Math.min(T, outH - y0);
        const cw = crop[2] - crop[0], ch = crop[3] - crop[1];
        const view: [number, number, number, number] = [crop[0] + (x0 / outW) * cw, crop[1] + (y0 / outH) * ch, crop[0] + ((x0 + w) / outW) * cw, crop[1] + ((y0 + h) / outH) * ch];
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, w, h);
        this.bind(u, view, w, h, false, -1, false);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        for (let row = 0; row < h; row++) {
          const s = row * w * 4;
          out.data.set(buf.subarray(s, s + w * 4), ((y0 + row) * outW + x0) * 4);
        }
        onTile?.(++done, total);
        await new Promise((r) => setTimeout(r, 0));
      }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  dispose() {
    const gl = this.gl;
    [this.src, this.aux, this.lut, this.lutSkin, this.fboTex].forEach((t) => t && gl.deleteTexture(t));
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
