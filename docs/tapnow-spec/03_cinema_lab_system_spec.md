# TapNow 创意画布全景工程落地规范
## 第 03 篇：Cinema Lab 电影实验室专项技术规范 (Cinema Lab System Spec)

> **版本**：v1.0.0  
> **面向对象**：视听算法工程师、Prompt 工程设计师、机位控制组件开发者  
> **核心目标**：解密 TapNow 的核心杀手锏功能 Cinema Lab，提供三维运镜数学映射、镜头器材预设字典、灯光系统以及将 UI 参数编译为生视频底层提示词的编译算法。

---

### 1. 架构定位：将导演心理模型代码化

在传统的视频大模型（Runway, Kling, Sora, Pika）交互中，用户通常需要手动编写大量晦涩的英文术语（如 `dolly zoom, 35mm anamorphic lens, rim lighting, 8k raw`），且生成结果不可控。

TapNow 的 **Cinema Lab** 将好莱坞电影工业的标准摄影工序，解构为三个可视化的软件控制层：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Cinema Lab 控制台                                │
├───────────────────────────────────┬────────────────────────────────────┤
│ 1. 三维多轴机位 (Camera Control)  │ 2. 传奇镜头组 (Lens Combos)        │
│   - Pan (水平摇镜)                 │   - Arri Alexa 65 + Cooke          │
│   - Tilt (垂直俯仰)                │   - RED V-Raptor + Zeiss Prime     │
│   - Zoom (推拉变焦)                │   - Canon K-35 Vintage Glass       │
│   - Roll (荷兰角倾斜)              │   - Sony FX9 Documentary           │
├───────────────────────────────────┴────────────────────────────────────┤
│ 3. 摄影棚光影与氛围 (Studio Lighting & Atmosphere)                     │
│   - 主光 (Key Light) | 辅光 (Fill) | 轮廓发光 (Rim Light) | 体积光 (Fog)  │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ 编译引擎 (Cinema Prompt Compiler)
┌────────────────────────────────────────────────────────────────────────┐
│  标准化 JSON 指令 或 结构化多模态视频提示词 (发往 Kling 3.0 / Seedance)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 2. 三维多轴机位运镜系统 (Camera Control)

#### 2.1 运动轴向与参数量化

每个镜头在 Cinema Lab 中被映射为一个六自由度（6-DoF）虚拟摄影机空间运动矩阵：

| 运镜轴向 (Axis) | 物理运动含义 | UI 控件形式 | 参数取值范围 | 默认值 |
| :--- | :--- | :--- | :--- | :--- |
| **Pan (水平摇镜)** | 摄影机原地水平向左/向右转动 | 双向刻度滑块 / 旋钮 | `[-10.0, +10.0]` (-10 左摇，+10 右摇) | `0.0` |
| **Tilt (垂直俯仰)** | 摄影机原地向上仰视/向下俯视 | 垂直刻度滑块 / 旋钮 | `[-10.0, +10.0]` (-10 俯视，+10 仰视) | `0.0` |
| **Zoom (推拉变焦)** | 光学镜头拉远（Wide）与推近（Tele） | 标尺滑块 | `[-10.0, +10.0]` (-10 远离，+10 推入) | `0.0` |
| **Roll (荷兰角旋转)** | 摄影机顺时针/逆时针倾斜拍摄 | 360 度罗盘转盘 | `[-180°, +180°]` | `0°` |
| **Truck (横向平移)** | 摄影机架在滑轨上向左/向右水平滑动 | 方向选择器 | `Left / None / Right` | `None` |
| **Pedestal (垂直升降)**| 摄影机整体升高或降低机位 | 升降拨钮 | `Up / None / Down` | `None` |

#### 2.2 运动加减速曲线 (Motion Dynamics Curve)
- **Linear（匀速运动）**：机械平滑移动，适合严肃纪录片与工业产品展示。
- **Ease-in-out（电影级缓入缓出）**：好莱坞摇臂摄影机标准物理动量曲线，起始平缓、中段稳健、末端自然减速。
- **Snap Zoom（冲击式快拉）**：用于动作戏、惊悚转场或情绪高潮瞬间（希区柯克变焦效果）。

---

### 3. 好莱坞传奇器材组合预设 (Cine Lens Combos)

TapNow 预置了 6 种行业最具代表性的顶级摄影机与电影镜头组合。选定后，底层自动注入对应的光学特征与色散校正描述：

#### 3.1 预设字典定义 (TypeScript 代码规范)

```typescript
export interface CineLensCombo {
  id: string;
  name: string;
  cameraBody: string;
  lensType: string;
  focalLength: string;
  aspectRatio: '16:9' | '2.35:1' | '1:1';
  visualCharacteristics: string;
  promptInjection: string;
}

export const CINE_LENS_PRESETS: Record<string, CineLensCombo> = {
  'arri-cooke-anamorphic': {
    id: 'arri-cooke-anamorphic',
    name: '好莱坞宽银幕传奇 (Arri + Cooke)',
    cameraBody: 'ARRI ALEXA 65',
    lensType: 'Cooke Anamorphic /i Full Frame Plus',
    focalLength: '40mm Anamorphic',
    aspectRatio: '2.35:1',
    visualCharacteristics: '水平椭圆光斑、暖色眩光、柔和肤色、宽银幕电影大片质感',
    promptInjection: 'shot on ARRI ALEXA 65 with Cooke Anamorphic lens, 2.35:1 cinemascope ratio, subtle horizontal blue-gold lens flares, creamy cinematic bokeh, organic film grain, rich dynamic range, MasterClass cinematography',
  },
  'red-zeiss-supreme': {
    id: 'red-zeiss-supreme',
    name: '顶级商业广告锐度 (RED + Zeiss)',
    cameraBody: 'RED V-RAPTOR 8K VV',
    lensType: 'Zeiss Supreme Prime',
    focalLength: '50mm T1.5',
    aspectRatio: '16:9',
    visualCharacteristics: '极致锐利、色彩精准还原、零色散、现代工业商业大片',
    promptInjection: 'shot on RED V-RAPTOR 8K with Zeiss Supreme Prime lens, crystal clear hyper-detail, perfectly controlled chromatic aberration, modern commercial grade sharpness, deep rich blacks, pristine color grading',
  },
  'canon-k35-vintage': {
    id: 'canon-k35-vintage',
    name: '70年代复古胶片 (Canon K-35)',
    cameraBody: 'Arriflex 35 III',
    lensType: 'Canon K-35 Vintage Primes (1970s)',
    focalLength: '35mm T1.3',
    aspectRatio: '16:9',
    visualCharacteristics: '梦幻低反差、复古温暖高光、胶片边缘晕影、怀旧质感',
    promptInjection: 'shot on 35mm film with vintage Canon K-35 prime lenses, warm nostalgic tone, glowing golden halation around highlights, gentle edge falloff, authentic vintage film grain, 1970s cinema aesthetic',
  },
  'sony-fx9-gmaster': {
    id: 'sony-fx9-gmaster',
    name: '纪实现场视感 (Sony FX9 + G Master)',
    cameraBody: 'Sony FX9 Full-Frame',
    lensType: 'Sony FE C 16-35mm T3.1 G Cinema',
    focalLength: '24mm Wide',
    aspectRatio: '16:9',
    visualCharacteristics: '高真实度、自然景深、现场呼吸感',
    promptInjection: 'shot on Sony FX9 full frame cinema camera, handheld camera breathing, documentary realism, natural ambient color fidelity, lifelike textures',
  },
};
```

---

### 4. 影视级三点布光系统 (Studio Lighting System)

在 Cinema Lab 设置抽屉中，用户可通过一键式图标选择布光风格：

```
┌────────────────────────────────────────────────────────────┐
│ 💡 影视布光方案 (Studio Lighting Scheme)                   │
├────────────────────────────────────────────────────────────┤
│ [☀️ 三点经典]  [🌙 黑色电影 Film Noir]  [🌫️ 体积光/丁达尔]  │
│ [🌈 赛博霓虹]  [🕯️ 暖调烛光暖光]         [⚡ 高能戏剧舞台光] │
└────────────────────────────────────────────────────────────┘
```

| 布光预设名称 | 核心光影配置 | 注入生图生视频提示词 |
| :--- | :--- | :--- |
| **Three-Point Classic** | 主光 45° + 柔和辅光 + 锐利发丝轮廓光 | `professional 3-point studio lighting, soft key light at 45 degrees, gentle fill shadow control, crisp rim edge separation` |
| **Film Noir (黑色电影)** | 单侧高对比度硬光，大面积深邃阴影 | `dramatic Film Noir high-contrast low-key chiaroscuro lighting, deep Venetian blind shadows, intense silhouette` |
| **Volumetric Atmosphere** | 晨曦/夜雾中的穿透光线，丁达尔效应 | `volumetric light beams cutting through dense atmospheric dust, Tyndall effect, god rays, cinematic haze, mood atmosphere` |
| **Cyberpunk Neon** | 青色与品红双色边缘对撞 | `dual-tone cyber lighting, vibrant cyan and magenta rim reflections, glossy wet surfaces catching neon reflections` |

---

### 5. 提示词编译器实现算法 (Prompt Compiler Implementation)

后续后端或 AI 在提交视频任务至底层 API（如 Kling / Seedance）时，必须通过 `compileCinemaPrompt` 函数将画布参数序列化为最终指令：

```typescript
export interface CompileOptions {
  basePrompt: string;
  negativePrompt?: string;
  lensComboId?: string;
  lightingPreset?: string;
  cameraMovement?: {
    pan: number;
    tilt: number;
    zoom: number;
    roll: number;
    curve?: string;
  };
}

export function compileCinemaPrompt(options: CompileOptions): {
  compiledPrompt: string;
  cameraCommandJson: Record<string, unknown>;
} {
  const promptParts: string[] = [];

  // 1. 基础创意描述
  promptParts.push(options.basePrompt.trim());

  // 2. 注入运镜指令 (Camera Movement)
  if (options.cameraMovement) {
    const camParts: string[] = [];
    const { pan, tilt, zoom, roll } = options.cameraMovement;

    if (zoom > 2) camParts.push('camera smoothly zooms in towards the subject');
    else if (zoom < -2) camParts.push('camera pulls back to reveal the wider scene');

    if (pan > 2) camParts.push('camera pans steadily to the right');
    else if (pan < -2) camParts.push('camera pans steadily to the left');

    if (tilt > 2) camParts.push('camera tilts upwards');
    else if (tilt < -2) camParts.push('camera tilts downwards');

    if (Math.abs(roll) > 5) camParts.push(`dutch angle tilted at ${roll} degrees`);

    if (camParts.length > 0) {
      promptParts.push(`Camera movement: ${camParts.join(', ')}`);
    }
  }

  // 3. 注入镜头与器材组合 (Lens Preset)
  if (options.lensComboId && CINE_LENS_PRESETS[options.lensComboId]) {
    promptParts.push(CINE_LENS_PRESETS[options.lensComboId].promptInjection);
  }

  // 4. 注入布光预设 (Lighting Preset)
  if (options.lightingPreset) {
    // 映射预设字典
    promptParts.push(`Lighting: ${options.lightingPreset}`);
  }

  // 5. 最终组装
  const compiledPrompt = promptParts.filter(Boolean).join('. ');

  return {
    compiledPrompt,
    cameraCommandJson: {
      pan: options.cameraMovement?.pan ?? 0,
      tilt: options.cameraMovement?.tilt ?? 0,
      zoom: options.cameraMovement?.zoom ?? 0,
      roll: options.cameraMovement?.roll ?? 0,
    },
  };
}
```

---

### 6. 对接 Reizo Studio 现有模块的零成本扩展方案

Reizo Studio 目前已经在 [`src/shared/cameraMotion.ts`](file:///e:/CodeCode/Reizo/desktop/src/shared/cameraMotion.ts) 实现了六轴运镜（Pan, Tilt, Zoom, Roll, Track, Boom）以及在 [`src/renderer/components/canvas/CameraDial.tsx`](file:///e:/CodeCode/Reizo/desktop/src/renderer/components/canvas/CameraDial.tsx) 实现了悬浮控制器。

**为了将其无缝升级为 TapNow 级别的 Cinema Lab，后续 AI 开发者只需进行以下极简修改**：

#### 6.1 在 `src/shared/cameraMotion.ts` 扩展接口字段
```typescript
export interface CameraControl {
  horizontal?: number;
  vertical?: number;
  pan?: number;
  tilt?: number;
  roll?: number;
  zoom?: number;
  // [新增 Cinema Lab 属性]
  lensCombo?: string;       // 如 'arri-cooke-anamorphic'
  lighting?: string;        // 如 'three-point' | 'film-noir' | 'volumetric'
}
```

并在 `cameraToPrompt(c: CameraControl)` 末尾直接追加：
```typescript
if (c.lensCombo && CINE_LENS_PRESETS[c.lensCombo]) {
  parts.push(CINE_LENS_PRESETS[c.lensCombo].promptInjection);
}
if (c.lighting && STUDIO_LIGHTING_PRESETS[c.lighting]) {
  parts.push(STUDIO_LIGHTING_PRESETS[c.lighting].promptInjection);
}
```

#### 6.2 在 `CameraDial.tsx` 弹窗底部增加镜头与灯光胶囊
在原有的 6 轴滑块下方，增加两行轻量的 Pill 选择器：
- 渲染 `CINE_LENS_PRESETS` 列表（显示镜头名称，如 Arri+Cooke）；
- 渲染 `STUDIO_LIGHTING_PRESETS` 列表（显示布光名称，如 黑色电影 / 体积光）。
点击即可将 `lensCombo` 和 `lighting` 一并保存在 node 的 `camera` 参数中，直接生效！

