import maplibregl from 'maplibre-gl';

const VERT_SRC = `#version 300 es
precision highp float;

uniform mat4 u_matrix;

in vec2 a_position;
in vec2 a_uv;

out vec2 v_uv;

void main() {
  gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
  v_uv = a_uv;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_height;
uniform vec2 u_texSize;
uniform float u_cellSize;
uniform float u_minHeight;
uniform float u_maxHeight;
uniform float u_seaLevel;
uniform float u_verticalExaggeration;

void main() {
  vec2 step = 1.0 / u_texSize;
  float h = texture(u_height, v_uv).r;
  float hL = texture(u_height, v_uv - vec2(step.x, 0.0)).r;
  float hR = texture(u_height, v_uv + vec2(step.x, 0.0)).r;
  float hD = texture(u_height, v_uv - vec2(0.0, step.y)).r;
  float hU = texture(u_height, v_uv + vec2(0.0, step.y)).r;

  float ve = u_verticalExaggeration;
  float dx = ((hR - hL) * ve) / (2.0 * u_cellSize);
  float dy = ((hU - hD) * ve) / (2.0 * u_cellSize);

  vec3 normal = normalize(vec3(-dx, -dy, 1.0));
  vec3 sunDir = normalize(vec3(-0.5, 0.5, 0.707));
  float shade = clamp(dot(normal, sunDir), 0.0, 1.0);
  shade = 0.4 + 0.6 * shade;

  float t = clamp((h - u_minHeight) / max(1.0, u_maxHeight - u_minHeight), 0.0, 1.0);
  vec3 lowlands  = vec3(0.42, 0.52, 0.28);
  vec3 plains    = vec3(0.70, 0.65, 0.45);
  vec3 hills     = vec3(0.55, 0.42, 0.30);
  vec3 highlands = vec3(0.82, 0.80, 0.78);

  vec3 color;
  if (t < 0.33) {
    color = mix(lowlands, plains, t / 0.33);
  } else if (t < 0.66) {
    color = mix(plains, hills, (t - 0.33) / 0.33);
  } else {
    color = mix(hills, highlands, (t - 0.66) / 0.34);
  }

  vec3 waterColor = vec3(0.15, 0.30, 0.55);
  float waterFrac = clamp((u_seaLevel - h) / 4.0, 0.0, 1.0);
  color = mix(color, waterColor, waterFrac);

  vec3 finalColor = color * shade;
  fragColor = vec4(finalColor, 1.0);
}
`;

export interface TerrainLayerInput {
  /** Row-major heightmap in meters, length = cols * rows. */
  heights: Float32Array;
  cols: number;
  rows: number;
  cellSize: number;
  minHeight: number;
  maxHeight: number;
  seaLevel: number;
  /** Four corners of the terrain extent in WGS84 lon/lat, CCW from SW. */
  cornersLonLat: readonly [number, number][];
  verticalExaggeration?: number;
}

export class TerrainLayer implements maplibregl.CustomLayerInterface {
  readonly id = 'hjemby-terrain';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private input: TerrainLayerInput;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private uvBuffer: WebGLBuffer | null = null;
  private heightTexture: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private linearFloatSupported = false;

  constructor(input: TerrainLayerInput) {
    this.input = input;
  }

  onAdd(_map: maplibregl.Map, gl: WebGL2RenderingContext | WebGLRenderingContext): void {
    if (!('createVertexArray' in gl)) {
      throw new Error('TerrainLayer requires WebGL2');
    }
    const gl2 = gl as WebGL2RenderingContext;

    // R32F + LINEAR filter requires the OES_texture_float_linear extension,
    // which isn't universally supported. We try to enable it; uploadHeightmap
    // picks LINEAR vs NEAREST based on availability.
    this.linearFloatSupported = gl2.getExtension('OES_texture_float_linear') !== null;

    this.program = compileProgram(gl2, VERT_SRC, FRAG_SRC);
    gl2.useProgram(this.program);

    this.uniforms = {
      u_matrix: gl2.getUniformLocation(this.program, 'u_matrix'),
      u_height: gl2.getUniformLocation(this.program, 'u_height'),
      u_texSize: gl2.getUniformLocation(this.program, 'u_texSize'),
      u_cellSize: gl2.getUniformLocation(this.program, 'u_cellSize'),
      u_minHeight: gl2.getUniformLocation(this.program, 'u_minHeight'),
      u_maxHeight: gl2.getUniformLocation(this.program, 'u_maxHeight'),
      u_seaLevel: gl2.getUniformLocation(this.program, 'u_seaLevel'),
      u_verticalExaggeration: gl2.getUniformLocation(this.program, 'u_verticalExaggeration'),
    };

    this.vao = gl2.createVertexArray();
    gl2.bindVertexArray(this.vao);

    this.positionBuffer = gl2.createBuffer();
    this.uvBuffer = gl2.createBuffer();
    this.heightTexture = gl2.createTexture();

    this.uploadGeometry(gl2);
    this.uploadHeightmap(gl2);

    const posLoc = gl2.getAttribLocation(this.program, 'a_position');
    gl2.bindBuffer(gl2.ARRAY_BUFFER, this.positionBuffer);
    gl2.enableVertexAttribArray(posLoc);
    gl2.vertexAttribPointer(posLoc, 2, gl2.FLOAT, false, 0, 0);

    const uvLoc = gl2.getAttribLocation(this.program, 'a_uv');
    gl2.bindBuffer(gl2.ARRAY_BUFFER, this.uvBuffer);
    gl2.enableVertexAttribArray(uvLoc);
    gl2.vertexAttribPointer(uvLoc, 2, gl2.FLOAT, false, 0, 0);

    gl2.bindVertexArray(null);
  }

  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext | WebGLRenderingContext): void {
    const gl2 = gl as WebGL2RenderingContext;
    if (this.program) gl2.deleteProgram(this.program);
    if (this.positionBuffer) gl2.deleteBuffer(this.positionBuffer);
    if (this.uvBuffer) gl2.deleteBuffer(this.uvBuffer);
    if (this.heightTexture) gl2.deleteTexture(this.heightTexture);
    if (this.vao) gl2.deleteVertexArray(this.vao);
    this.program = null;
    this.positionBuffer = null;
    this.uvBuffer = null;
    this.heightTexture = null;
    this.vao = null;
  }

  render(gl: WebGL2RenderingContext | WebGLRenderingContext, options: maplibregl.CustomRenderMethodInput): void {
    if (!this.program) return;
    const gl2 = gl as WebGL2RenderingContext;
    gl2.useProgram(this.program);
    gl2.bindVertexArray(this.vao);

    gl2.activeTexture(gl2.TEXTURE0);
    gl2.bindTexture(gl2.TEXTURE_2D, this.heightTexture);
    gl2.uniform1i(this.uniforms.u_height!, 0);

    const mvp = options.defaultProjectionData.mainMatrix;
    const mat = mvp instanceof Float32Array ? mvp : new Float32Array(mvp);
    gl2.uniformMatrix4fv(this.uniforms.u_matrix!, false, mat);

    gl2.uniform2f(this.uniforms.u_texSize!, this.input.cols, this.input.rows);
    gl2.uniform1f(this.uniforms.u_cellSize!, this.input.cellSize);
    gl2.uniform1f(this.uniforms.u_minHeight!, this.input.minHeight);
    gl2.uniform1f(this.uniforms.u_maxHeight!, this.input.maxHeight);
    gl2.uniform1f(this.uniforms.u_seaLevel!, this.input.seaLevel);
    gl2.uniform1f(this.uniforms.u_verticalExaggeration!, this.input.verticalExaggeration ?? 1);

    gl2.disable(gl2.DEPTH_TEST);
    gl2.disable(gl2.STENCIL_TEST);
    gl2.disable(gl2.CULL_FACE);
    gl2.disable(gl2.SCISSOR_TEST);
    gl2.enable(gl2.BLEND);
    gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);

    gl2.drawArrays(gl2.TRIANGLE_STRIP, 0, 4);
    gl2.bindVertexArray(null);
  }

  private uploadGeometry(gl: WebGL2RenderingContext): void {
    const c = this.input.cornersLonLat;
    const sw = maplibregl.MercatorCoordinate.fromLngLat({ lng: c[0]![0], lat: c[0]![1] });
    const se = maplibregl.MercatorCoordinate.fromLngLat({ lng: c[1]![0], lat: c[1]![1] });
    const ne = maplibregl.MercatorCoordinate.fromLngLat({ lng: c[2]![0], lat: c[2]![1] });
    const nw = maplibregl.MercatorCoordinate.fromLngLat({ lng: c[3]![0], lat: c[3]![1] });

    // MapLibre v5 custom layers use `defaultProjectionData.mainMatrix`, which
    // expects vertices in raw Mercator [0,1] space (the EXTENT scaling is
    // already baked into the matrix). Triangle strip order: SW, SE, NW, NE.
    const positions = new Float32Array([sw.x, sw.y, se.x, se.y, nw.x, nw.y, ne.x, ne.y]);
    // UVs: y=0 at south, y=1 at north (matches heightmap row 0 = south)
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  }

  private uploadHeightmap(gl: WebGL2RenderingContext): void {
    const { cols, rows, heights } = this.input;
    const filter = this.linearFloatSupported ? gl.LINEAR : gl.NEAREST;
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, cols, rows, 0, gl.RED, gl.FLOAT, heights);
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader returned null');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function compileProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram returned null');
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}
