import * as THREE from 'three';

/** 全林共享的季节 / 风 / 雾 uniform，UI 每帧只改这一处 */
export interface ForestUniforms {
  uTime: { value: number };
  uWindStrength: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uFogColor: { value: THREE.Color };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uSeason: { value: number }; // 0..3
  uSeasonMix: { value: number }; // 季节间插值 0..1
  uLeafColorA: { value: THREE.Color };
  uLeafColorB: { value: THREE.Color };
  uLeafCoverage: { value: number }; // 全局落叶覆盖率 0..1
  uBarkColor: { value: THREE.Color };
  uAmbient: { value: number };
}

export function createForestUniforms(): ForestUniforms {
  return {
    uTime: { value: 0 },
    uWindStrength: { value: 0.35 },
    uSunDir: { value: new THREE.Vector3(0.45, 0.62, 0.35).normalize() },
    uFogColor: { value: new THREE.Color('#cfe0d2') },
    uFogNear: { value: 60 },
    uFogFar: { value: 190 },
    uSeason: { value: 0 },
    uSeasonMix: { value: 0 },
    uLeafColorA: { value: new THREE.Color('#6fb04a') },
    uLeafColorB: { value: new THREE.Color('#6fb04a') },
    uLeafCoverage: { value: 1 },
    uBarkColor: { value: new THREE.Color('#6b5238') },
    uAmbient: { value: 0.35 },
  };
}

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  vec3 applyFog(vec3 color, float dist) {
    float f = smoothstep(uFogNear, uFogFar, dist);
    return mix(color, uFogColor, f);
  }
`;

/** 枝干材质：顶点着色器里做随高度/枝梢加权的风摆 */
export function createBranchMaterial(u: ForestUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: u as unknown as { [k: string]: THREE.IUniform },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWindStrength;
      attribute float branchId;
      attribute vec3 aBarkColor;
      varying vec3 vNormal;
      varying float vHeight;
      varying float vFogDepth;
      varying vec3 vBark;

      void main() {
        vBark = aBarkColor;
        vec3 transformed = position;
        // 枝梢越细摆得越厉害：用 y 高度近似枝序权重
        float swayWeight = smoothstep(0.2, 6.0, position.y);
        float wave = sin(uTime * 1.7 + position.x * 0.55 + position.z * 0.4) * 0.06
                   + sin(uTime * 3.1 + position.z * 0.9) * 0.025;
        transformed.x += wave * swayWeight * uWindStrength * 2.0;
        transformed.z += cos(uTime * 1.3 + position.x * 0.7) * 0.05 * swayWeight * uWindStrength * 2.0;

        #ifdef USE_INSTANCING
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        #else
          vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
          vNormal = normalize(normalMatrix * normal);
        #endif
        vFogDepth = -mv.z;
        vHeight = position.y;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSunDir;
      uniform float uAmbient;
      varying vec3 vNormal;
      varying float vHeight;
      varying float vFogDepth;
      varying vec3 vBark;
      ${FOG_GLSL}
      void main() {
        float ndl = max(dot(normalize(vNormal), normalize(uSunDir)), 0.0);
        vec3 col = vBark * (uAmbient + ndl * 0.75);
        col *= 0.9 + 0.1 * clamp(vHeight * 0.2, 0.0, 1.0);
        gl_FragColor = vec4(applyFog(col, vFogDepth), 1.0);
      }
    `,
  });
}

/**
 * 叶片材质：全部叶片经一次 instanced draw 提交。
 * 实例属性：aLeafPos/aLeafDir/aLeafSeed + aTreeAge/aTreeDensity/aScale。
 * 顶点着色器完成风摆、落叶裁剪和叶色混合。
 */
export function createLeafMaterial(u: ForestUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: u as unknown as { [k: string]: THREE.IUniform },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uLeafCoverage;
      attribute vec3 aLeafPos;
      attribute vec3 aLeafDir;
      attribute float aLeafSeed;
      attribute float aTreeAge;     // 0..1 成熟度
      attribute float aTreeDensity; // 该树密度变体 0.45 / 0.7 / 1
      attribute float aScale;       // 叶片世界尺寸
      varying vec3 vNormal;
      varying float vPhase;
      varying float vFogDepth;
      varying float vDiscard;

      void main() {
        // 叶量 = 全局季节落叶 × 该树密度 × 成熟度；按实例种子确定性裁剪
        float keep = uLeafCoverage * aTreeDensity * clamp(aTreeAge * 1.4, 0.15, 1.0);
        float localSeed = fract(aLeafSeed * 0.6180339);
        vDiscard = step(localSeed, keep); // localSeed > keep 时丢弃

        // 本地四边形朝向：让叶平面大致垂直于枝条方向
        vec3 tangent = normalize(aLeafDir + vec3(0.001, 0.0, 0.002));
        vec3 side = normalize(cross(tangent, vec3(0.0, 1.0, 0.0)));
        vec3 upv = cross(side, tangent);
        float spin = aLeafSeed;
        float cs = cos(spin), sn = sin(spin);
        vec3 local = position * aScale;
        vec3 worldLeaf = aLeafPos
          + side * (local.x * cs - local.y * sn) + upv * (local.x * sn + local.y * cs);

        // 风：高频颤动 + 低频摆动，冠层上部更明显
        float flutter = sin(uTime * 6.0 + aLeafSeed * 12.0) * 0.035;
        float sway = sin(uTime * 1.9 + aLeafPos.x * 0.4 + aLeafPos.z * 0.5) * 0.09;
        float hWeight = clamp(aLeafPos.y * 0.08, 0.0, 1.0);
        worldLeaf.x += (flutter + sway) * hWeight * uWindStrength * 3.0;
        worldLeaf.z += cos(uTime * 2.4 + aLeafSeed * 7.0) * 0.05 * hWeight * uWindStrength * 3.0;

        vec4 mv = modelViewMatrix * vec4(worldLeaf, 1.0);
        vFogDepth = -mv.z;
        vNormal = normalize(normalMatrix * side);
        vPhase = localSeed;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSunDir;
      uniform vec3 uLeafColorA;
      uniform vec3 uLeafColorB;
      uniform float uSeasonMix;
      uniform float uAmbient;
      varying vec3 vNormal;
      varying float vPhase;
      varying float vFogDepth;
      varying float vDiscard;
      ${FOG_GLSL}
      void main() {
        if (vDiscard < 0.5) discard;
        // 叶面间轻微色差，避免上万片叶颜色发死
        vec3 base = mix(uLeafColorA, uLeafColorB, uSeasonMix);
        float variation = 0.82 + 0.18 * vPhase;
        float ndl = max(dot(normalize(vNormal), normalize(uSunDir)), 0.0);
        // 简单次表面透光：背光面也保留一点暖色
        float wrap = max(dot(normalize(vNormal), normalize(uSunDir)) * 0.5 + 0.5, 0.0);
        vec3 col = base * variation * (uAmbient + ndl * 0.65 + wrap * 0.2);
        gl_FragColor = vec4(applyFog(col, vFogDepth), 1.0);
      }
    `,
  });
}

/** 远景 LOD 十字牌材质：程序化噪声 alpha 模拟冠团 */
export function createCardMaterial(u: ForestUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: u as unknown as { [k: string]: THREE.IUniform },
    side: THREE.DoubleSide,
    alphaTest: 0.4,
    transparent: true,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWindStrength;
      varying vec2 vUv;
      varying float vFogDepth;
      varying vec3 vNormal;
      void main() {
        vec3 transformed = position;
        float hWeight = clamp(position.y * 0.2, 0.0, 1.0);
        transformed.x += sin(uTime * 1.6 + position.z * 0.5) * 0.08 * hWeight * uWindStrength * 2.0;
        #ifdef USE_INSTANCING
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        #else
          vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
          vNormal = normalize(normalMatrix * normal);
        #endif
        vFogDepth = -mv.z;
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSunDir;
      uniform vec3 uLeafColorA;
      uniform vec3 uLeafColorB;
      uniform float uSeasonMix;
      uniform float uLeafCoverage;
      uniform float uAmbient;
      varying vec2 vUv;
      varying float vFogDepth;
      varying vec3 vNormal;
      ${FOG_GLSL}
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      void main() {
        if (uLeafCoverage < 0.08) discard;
        vec2 q = vUv * 6.0;
        float n = noise(q) * 0.6 + noise(q * 2.3 + 5.0) * 0.4;
        float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x)
                   * smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
        float alpha = smoothstep(0.35, 0.6, n) * edge;
        if (alpha < 0.4) discard;
        vec3 base = mix(uLeafColorA, uLeafColorB, uSeasonMix);
        float ndl = 0.55 + 0.45 * max(dot(normalize(vNormal), normalize(uSunDir)), 0.0);
        vec3 col = base * (uAmbient + ndl * 0.7);
        gl_FragColor = vec4(applyFog(col, vFogDepth), alpha);
      }
    `,
  });
}
