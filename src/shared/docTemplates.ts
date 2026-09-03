/**
 * Scenario-seeded starting points for "新建文档". Each is a Markdown skeleton
 * with a Goal section and a short guide tailored to what the user is about to
 * make — so the agent (or the user) fills a structured brief rather than a
 * blank page.
 */
export interface DocTemplate {
  id: string;
  label: string;
  fileName: string;
  body: string;
}

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    id: 'blank',
    label: '空白文档',
    fileName: '文档.md',
    body: '# 标题\n\n',
  },
  {
    id: 'image-brief',
    label: '图片需求',
    fileName: '图片需求.md',
    body: `# 图片需求

## 目标
（这张图要用在哪里、传达什么）

## 规格
- 主体：
- 画幅 / 比例：
- 构图：
- 视觉风格：
- 品牌色 / 关键色：
- 参考图 / 参考风格：
- 负向约束（不要出现什么）：
`,
  },
  {
    id: 'video-storyboard',
    label: '视频分镜',
    fileName: '视频分镜.md',
    body: `# 视频分镜

## 目标
（时长、平台、核心信息）

## 分镜表
| # | 画面 | 时长 | 字幕 / 旁白 | 运动 | 素材 | 音频 |
|---|------|------|-------------|------|------|------|
| 1 |      |      |             |      |      |      |

## 输出
- 分辨率 / 帧率：
- 交付格式：
`,
  },
  {
    id: 'spec',
    label: '方案 / 需求',
    fileName: '方案.md',
    body: `# 方案

## 目标
（要解决的问题，成功的样子）

## 背景与约束

## 方案

## 里程碑
- [ ]

## 风险与未决问题
`,
  },
  {
    id: 'landing',
    label: '落地页文案',
    fileName: '落地页文案.md',
    body: `# 落地页文案

## 目标受众与场景

## 结构
- Hero 主标题：
- 副标题：
- 主 CTA：
- 卖点 1 / 2 / 3：
- 社会证明：
- 次 CTA：

## 语气 / 风格
`,
  },
];
