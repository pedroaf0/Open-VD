import * as THREE from "three";

/**
 * Técnicas de transparência order-independent usadas pelo Volume3D.
 *
 * O laboratório de transparência mostrou que:
 *  - Weighted Blended OIT é o melhor equilíbrio entre qualidade e custo;
 *  - Depth Peeling é a referência de ordem por pixel, porém custa várias
 *    passadas de geometria;
 *  - a configuração antiga (depthWrite: true) bloqueia as estruturas internas.
 *
 * Este módulo mantém o shader padrão do Three (MeshStandard/MeshPhong) e injeta
 * apenas a lógica de amostragem/composição, para preservar iluminação e cores.
 */

export type TransparencyUniforms = {
  mode: { value: number };
  peelPrev: { value: THREE.DepthTexture | null };
  peelHasPrev: { value: number };
  staticDepth: { value: THREE.DepthTexture | null };
  hasStaticDepth: { value: number };
  invResolution: { value: THREE.Vector2 };
  oitDepthScale: { value: number };
  oitWeight: { value: number };
};

export function createTransparencyUniforms(): TransparencyUniforms {
  return {
    mode: { value: 0 },
    peelPrev: { value: null },
    peelHasPrev: { value: 0 },
    staticDepth: { value: null },
    hasStaticDepth: { value: 0 },
    invResolution: { value: new THREE.Vector2(1, 1) },
    oitDepthScale: { value: 7.5 },
    oitWeight: { value: 1 },
  };
}

/**
 * Injeta o teste de profundidade estática e a amostragem de OIT/peeling no
 * fragment shader do material original.
 */
export function patchTransparencyMaterial(
  material: THREE.Material,
  uniforms: TransparencyUniforms,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uLabMode"] = uniforms.mode;
    shader.uniforms["uLabPeelPrev"] = uniforms.peelPrev;
    shader.uniforms["uLabPeelHasPrev"] = uniforms.peelHasPrev;
    shader.uniforms["uLabStaticDepth"] = uniforms.staticDepth;
    shader.uniforms["uLabHasStaticDepth"] = uniforms.hasStaticDepth;
    shader.uniforms["uLabInvResolution"] = uniforms.invResolution;
    shader.uniforms["uLabOitDepthScale"] = uniforms.oitDepthScale;
    shader.uniforms["uLabOitWeight"] = uniforms.oitWeight;

    shader.fragmentShader =
      /* glsl */ `
        uniform float uLabMode;
        uniform sampler2D uLabPeelPrev;
        uniform float uLabPeelHasPrev;
        uniform sampler2D uLabStaticDepth;
        uniform float uLabHasStaticDepth;
        uniform vec2 uLabInvResolution;
        uniform float uLabOitDepthScale;
        uniform float uLabOitWeight;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      /* glsl */ `
        #include <dithering_fragment>

        // Planos de corte opacos: descarta a metade da malha que fica ATRÁS do
        // corte (profundidade MAIOR que a do plano). A metade da frente segue
        // visível por cima do plano, como no modo rápido.
        if ( uLabMode > 0.5 && uLabHasStaticDepth > 0.5 ) {
          float labStaticDepth = texture2D( uLabStaticDepth, gl_FragCoord.xy * uLabInvResolution ).r;
          if ( labStaticDepth < 0.999999 && gl_FragCoord.z > labStaticDepth + 0.000001 ) discard;
        }

        // Depth peeling: descarta superfícies já capturadas por uma camada mais
        // próxima da câmera (profundidade MENOR ou igual à da camada anterior).
        if ( uLabMode > 2.5 && uLabPeelHasPrev > 0.5 ) {
          float labPrevDepth = texture2D( uLabPeelPrev, gl_FragCoord.xy * uLabInvResolution ).r;
          if ( gl_FragCoord.z <= labPrevDepth + 0.000001 ) discard;
        }

        // OIT: acumula cor ponderada pela profundidade.
        if ( uLabMode > 0.5 && uLabMode < 1.5 ) {
          float labAlpha = gl_FragColor.a;
          float labViewZ = max( 0.001, -vViewPosition.z );
          float labW = clamp( 0.03 / ( 1e-5 + pow( labViewZ / uLabOitDepthScale, 4.0 ) ), 0.01, 300.0 );
          labW *= uLabOitWeight;
          gl_FragColor = vec4( gl_FragColor.rgb * labAlpha * labW, labAlpha * labW );
        }

        // OIT: acumula revealage (quanto do fundo ainda aparece).
        if ( uLabMode > 1.5 && uLabMode < 2.5 ) {
          gl_FragColor = vec4( gl_FragColor.a );
        }
      `,
    );
  };

  material.customProgramCacheKey = () => "openvd-transparency-v2";
  material.alphaHash = false;
  material.needsUpdate = true;
}

function forEachMaterial(
  materials: THREE.Material[],
  fn: (material: THREE.Material) => void,
): void {
  for (const material of materials) fn(material);
}

export function setMaterialFast(material: THREE.Material): void {
  material.transparent = true;
  material.blending = THREE.NormalBlending;
  material.depthTest = true;
  material.depthWrite = true;
  material.side = THREE.DoubleSide;
}

export function setMaterialOitAccum(material: THREE.Material): void {
  material.transparent = true;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
}

export function setMaterialOitReveal(material: THREE.Material): void {
  material.transparent = true;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.ZeroFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
}

export function setMaterialPeel(material: THREE.Material): void {
  material.transparent = true;
  material.blending = THREE.NoBlending;
  material.depthTest = true;
  material.depthWrite = true;
  material.side = THREE.DoubleSide;
}

function createQuad(material: THREE.ShaderMaterial): {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  mesh: THREE.Mesh;
} {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { scene, camera, mesh };
}

const OIT_COMPOSITE_SHADER = {
  uniforms: {
    tAccum: { value: null as THREE.Texture | null },
    tReveal: { value: null as THREE.Texture | null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4( position.xy, 0.0, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tAccum;
    uniform sampler2D tReveal;
    varying vec2 vUv;

    void main() {
      vec4 accum = texture2D( tAccum, vUv );
      float reveal = clamp( texture2D( tReveal, vUv ).r, 0.0, 1.0 );
      float alpha = 1.0 - reveal;
      vec3 straight = accum.rgb / max( accum.a, 0.00001 );
      gl_FragColor = vec4( straight, alpha );
      #include <colorspace_fragment>
    }
  `,
};

export class WeightedOIT {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly uniforms: TransparencyUniforms;
  private width = 1;
  private height = 1;
  private accumTarget: THREE.WebGLRenderTarget | null = null;
  private revealTarget: THREE.WebGLRenderTarget | null = null;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly quad: ReturnType<typeof createQuad>;

  constructor(renderer: THREE.WebGLRenderer, uniforms: TransparencyUniforms) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.compositeMaterial = new THREE.ShaderMaterial({
      ...OIT_COMPOSITE_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = createQuad(this.compositeMaterial);
    this.setSize();
  }

  setSize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.width = Math.max(1, Math.floor(size.x));
    this.height = Math.max(1, Math.floor(size.y));

    this.accumTarget?.dispose();
    this.revealTarget?.dispose();

    const options: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    };
    this.accumTarget = new THREE.WebGLRenderTarget(this.width, this.height, options);
    this.revealTarget = new THREE.WebGLRenderTarget(this.width, this.height, options);
    this.uniforms.invResolution.value.set(1 / this.width, 1 / this.height);
  }

  dispose(): void {
    this.accumTarget?.dispose();
    this.revealTarget?.dispose();
    this.compositeMaterial.dispose();
    this.quad.mesh.geometry.dispose();
  }

  render(scene: THREE.Scene, camera: THREE.Camera, materials: THREE.Material[]): void {
    const renderer = this.renderer;
    if (!this.accumTarget || !this.revealTarget) return;

    const savedTarget = renderer.getRenderTarget();
    const savedAutoClear = renderer.autoClear;
    const savedClearColor = renderer.getClearColor(new THREE.Color());
    const savedClearAlpha = renderer.getClearAlpha();

    renderer.autoClear = false;
    this.uniforms.mode.value = 1;
    this.uniforms.peelHasPrev.value = 0;
    this.uniforms.peelPrev.value = null;
    forEachMaterial(materials, setMaterialOitAccum);

    renderer.setRenderTarget(this.accumTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(scene, camera);

    this.uniforms.mode.value = 2;
    forEachMaterial(materials, setMaterialOitReveal);

    renderer.setRenderTarget(this.revealTarget);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, false, false);
    renderer.render(scene, camera);

    this.uniforms.mode.value = 0;
    this.compositeMaterial.uniforms["tAccum"]!.value = this.accumTarget.texture;
    this.compositeMaterial.uniforms["tReveal"]!.value = this.revealTarget.texture;

    renderer.setRenderTarget(null);
    renderer.setClearColor(savedClearColor, savedClearAlpha);
    renderer.render(this.quad.scene, this.quad.camera);

    renderer.autoClear = savedAutoClear;
    renderer.setRenderTarget(savedTarget);
  }
}

const PEEL_LAYER_SHADER = {
  uniforms: {
    tPrev: { value: null as THREE.Texture | null },
    tLayer: { value: null as THREE.Texture | null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4( position.xy, 0.0, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tPrev;
    uniform sampler2D tLayer;
    varying vec2 vUv;

    void main() {
      vec4 prev = texture2D( tPrev, vUv );
      vec4 layer = texture2D( tLayer, vUv );
      vec3 rgb = prev.rgb + prev.a * layer.rgb * layer.a;
      float transmittance = prev.a * ( 1.0 - layer.a );
      gl_FragColor = vec4( rgb, transmittance );
    }
  `,
};

const PEEL_FINAL_SHADER = {
  uniforms: {
    tAccum: { value: null as THREE.Texture | null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4( position.xy, 0.0, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tAccum;
    varying vec2 vUv;

    void main() {
      vec4 accum = texture2D( tAccum, vUv );
      float alpha = 1.0 - accum.a;
      vec3 straight = accum.rgb / max( alpha, 0.00001 );
      gl_FragColor = vec4( straight, alpha );
      #include <colorspace_fragment>
    }
  `,
};

function createLayerTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const depthTexture = new THREE.DepthTexture(width, height);
  depthTexture.type = THREE.UnsignedIntType;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;

  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture,
    colorSpace: THREE.LinearSRGBColorSpace,
  });
}

export class DepthPeeling {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly uniforms: TransparencyUniforms;
  private width = 1;
  private height = 1;
  private layerTargets: THREE.WebGLRenderTarget[] = [];
  private accumTargets: THREE.WebGLRenderTarget[] = [];
  private readonly layerMaterial: THREE.ShaderMaterial;
  private readonly layerQuad: ReturnType<typeof createQuad>;
  private readonly finalMaterial: THREE.ShaderMaterial;
  private readonly finalQuad: ReturnType<typeof createQuad>;
  public maxLayers: number;

  constructor(renderer: THREE.WebGLRenderer, uniforms: TransparencyUniforms, maxLayers = 8) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.maxLayers = maxLayers;

    this.layerMaterial = new THREE.ShaderMaterial({
      ...PEEL_LAYER_SHADER,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.layerQuad = createQuad(this.layerMaterial);

    this.finalMaterial = new THREE.ShaderMaterial({
      ...PEEL_FINAL_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.finalQuad = createQuad(this.finalMaterial);

    this.setSize();
  }

  setSize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.width = Math.max(1, Math.floor(size.x));
    this.height = Math.max(1, Math.floor(size.y));

    for (const target of this.layerTargets) target.dispose();
    for (const target of this.accumTargets) target.dispose();

    this.layerTargets = [
      createLayerTarget(this.width, this.height),
      createLayerTarget(this.width, this.height),
    ];

    const accumOptions: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    };
    this.accumTargets = [
      new THREE.WebGLRenderTarget(this.width, this.height, accumOptions),
      new THREE.WebGLRenderTarget(this.width, this.height, accumOptions),
    ];
    this.uniforms.invResolution.value.set(1 / this.width, 1 / this.height);
  }

  dispose(): void {
    for (const target of this.layerTargets) target.dispose();
    for (const target of this.accumTargets) target.dispose();
    this.layerMaterial.dispose();
    this.layerQuad.mesh.geometry.dispose();
    this.finalMaterial.dispose();
    this.finalQuad.mesh.geometry.dispose();
  }

  render(scene: THREE.Scene, camera: THREE.Camera, materials: THREE.Material[]): void {
    const renderer = this.renderer;
    const layers = Math.max(1, Math.min(12, this.maxLayers));
    if (!this.layerTargets.length || !this.accumTargets.length) return;

    const savedTarget = renderer.getRenderTarget();
    const savedAutoClear = renderer.autoClear;
    const savedClearColor = renderer.getClearColor(new THREE.Color());
    const savedClearAlpha = renderer.getClearAlpha();

    renderer.autoClear = false;
    this.uniforms.mode.value = 3;
    this.uniforms.peelHasPrev.value = 0;
    // Desvincula a textura de profundidade anterior antes de renderizar na
    // mesma target; evita feedback loop no WebGL.
    this.uniforms.peelPrev.value = null;
    forEachMaterial(materials, setMaterialPeel);

    renderer.setRenderTarget(this.accumTargets[0]!);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);

    let accumRead = this.accumTargets[0]!;
    let accumWrite = this.accumTargets[1]!;

    for (let layer = 0; layer < layers; layer += 1) {
      const targetIndex = layer % 2;
      const target = this.layerTargets[targetIndex]!;
      const prev = this.layerTargets[1 - targetIndex]!;

      this.uniforms.peelHasPrev.value = layer > 0 ? 1 : 0;
      this.uniforms.peelPrev.value = layer > 0 ? prev.depthTexture : null;

      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);

      this.layerMaterial.uniforms["tPrev"]!.value = accumRead.texture;
      this.layerMaterial.uniforms["tLayer"]!.value = target.texture;
      renderer.setRenderTarget(accumWrite);
      renderer.render(this.layerQuad.scene, this.layerQuad.camera);

      const swap = accumRead;
      accumRead = accumWrite;
      accumWrite = swap;
    }

    this.finalMaterial.uniforms["tAccum"]!.value = accumRead.texture;
    renderer.setRenderTarget(null);
    renderer.setClearColor(savedClearColor, savedClearAlpha);
    renderer.render(this.finalQuad.scene, this.finalQuad.camera);

    this.uniforms.mode.value = 0;
    this.uniforms.peelHasPrev.value = 0;
    this.uniforms.peelPrev.value = null;
    renderer.autoClear = savedAutoClear;
    renderer.setRenderTarget(savedTarget);
  }
}

/** Target usado apenas para a profundidade dos planos de corte. */
export function createStaticDepthTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const depthTexture = new THREE.DepthTexture(width, height);
  depthTexture.type = THREE.UnsignedIntType;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;

  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture,
  });
}
