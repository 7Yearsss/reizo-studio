import { describe, expect, it } from 'vitest';
import type { CanvasNode } from './canvas';
import {
  buildEditPrompt,
  editReadiness,
  isLocalEdit,
  EDIT_META,
  pixelCropRect,
  splitGridRects,
  type ImageEditKind,
  type ImageEditSpec,
} from './canvasImageEdit';

function node(edit: ImageEditSpec): CanvasNode {
  return {
    id: 'edit',
    canvasId: 'c1',
    type: 'image',
    x: 0,
    y: 0,
    w: 320,
    h: 380,
    title: '裁剪',
    params: { prompt: '', size: '1024x1024', edit },
    paramsHash: null,
    runState: 'idle',
    output: null,
    updatedAt: '',
  };
}

function spec(partial: Partial<ImageEditSpec> & { kind: ImageEditKind }): ImageEditSpec {
  return { sourceNodeId: 'src', ...partial };
}

describe('isLocalEdit', () => {
  it('matches EDIT_META.local for every kind', () => {
    for (const kind of Object.keys(EDIT_META) as ImageEditKind[]) {
      expect(isLocalEdit(kind)).toBe(EDIT_META[kind].local);
    }
  });
});

describe('buildEditPrompt', () => {
  it('multiAngle includes rotate / tilt / zoom / wide-angle', () => {
    const text = buildEditPrompt(
      spec({
        kind: 'multiAngle',
        params: { rotateDeg: -30, tiltDeg: 23, zoom: 2, wideAngle: true },
      }),
    );
    expect(text).toContain('向左');
    expect(text).toContain('30 度');
    expect(text).toContain('俯视主体约 23 度');
    expect(text).toContain('推近');
    expect(text).toContain('广角');
  });

  it('inpaint includes mask note and instruction', () => {
    const text = buildEditPrompt(
      spec({ kind: 'inpaint', maskAsset: 'c1/mask.png', instruction: '换成红色气球' }),
    );
    expect(text).toContain('第二张图是蒙版');
    expect(text).toContain('换成红色气球');
  });

  it('inpaint with multiple regions maps colours to per-region instructions', () => {
    const text = buildEditPrompt(
      spec({
        kind: 'inpaint',
        maskAsset: 'c1/mask.png',
        regions: [
          { color: '#ff2d78', instruction: '换成火星地表' },
          { color: '#22d3ee', instruction: '加一只橘猫' },
        ],
      }),
    );
    expect(text).toContain('彩色蒙版');
    expect(text).toContain('品红色区域:换成火星地表');
    expect(text).toContain('青色区域:加一只橘猫');
  });

  it('inpaint multi-region falls back to smart-remove for a blank region', () => {
    const text = buildEditPrompt(
      spec({
        kind: 'inpaint',
        regions: [
          { color: '#ff2d78', instruction: '  ' },
          { color: '#22d3ee', instruction: '加字幕' },
        ],
      }),
    );
    expect(text).toContain('品红色区域:移除该区域的内容');
  });

  it('erase asks to fill without residue', () => {
    const text = buildEditPrompt(spec({ kind: 'erase', maskAsset: 'c1/m.png' }));
    expect(text).toContain('移除蒙版区域内的物体');
    expect(text).toContain('无痕填充');
  });

  it('relight includes direction, brightness, temperature, rim', () => {
    const text = buildEditPrompt(
      spec({
        kind: 'relight',
        params: { lightDir: 'left', brightness: 50, colorTempK: 3000, rimLight: true },
      }),
    );
    expect(text).toContain('主光来自左侧');
    expect(text).toContain('50%');
    expect(text).toContain('3000K');
    expect(text).toContain('轮廓光');
  });

  it('outpaint includes pad percentages and mask note', () => {
    const text = buildEditPrompt(
      spec({
        kind: 'outpaint',
        maskAsset: 'c1/m.png',
        params: { pad: { left: 0.2, right: 0.1, top: 0, bottom: 0.5 } },
      }),
    );
    expect(text).toContain('向左扩展约 20%');
    expect(text).toContain('向右扩展约 10%');
    expect(text).toContain('向下扩展约 50%');
    expect(text).toContain('第二张图是蒙版');
  });

  it('enhance mentions scale and strength band', () => {
    const strong = buildEditPrompt(spec({ kind: 'enhance', params: { scale: 4, strength: 80 } }));
    expect(strong).toContain('4 倍');
    expect(strong).toContain('较强');
    const mild = buildEditPrompt(spec({ kind: 'enhance', params: { scale: 2, strength: 40 } }));
    expect(mild).toContain('适度');
  });

  it('matting asks for transparent alpha', () => {
    const text = buildEditPrompt(spec({ kind: 'matting' }));
    expect(text).toContain('透明背景');
    expect(text).toContain('alpha');
  });
});

describe('editReadiness', () => {
  it('flags missing source image', () => {
    expect(editReadiness(node(spec({ kind: 'relight' })), false)).toEqual(['缺少源图输入']);
  });

  it('flags missing mask for inpaint/erase/outpaint', () => {
    expect(editReadiness(node(spec({ kind: 'erase' })), true)).toEqual(['尚未绘制蒙版']);
  });

  it('multi-region inpaint is ready when any region has text', () => {
    expect(
      editReadiness(
        node(
          spec({
            kind: 'inpaint',
            maskAsset: 'c1/m.png',
            regions: [
              { color: '#ff2d78', instruction: '  ' },
              { color: '#22d3ee', instruction: '加字幕' },
            ],
          }),
        ),
        true,
      ),
    ).toEqual([]);
  });

  it('flags empty inpaint instruction', () => {
    expect(editReadiness(node(spec({ kind: 'inpaint', maskAsset: 'c1/m.png', instruction: '  ' })), true)).toEqual([
      '重绘描述为空',
    ]);
  });

  it('is silent when ready', () => {
    expect(
      editReadiness(node(spec({ kind: 'inpaint', maskAsset: 'c1/m.png', instruction: '红气球' })), true),
    ).toEqual([]);
    expect(editReadiness(node(spec({ kind: 'matting' })), true)).toEqual([]);
  });
});

describe('pixelCropRect / splitGridRects', () => {
  it('crops the center 50% of a 640×640 image to 320×320', () => {
    expect(pixelCropRect(640, 640, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })).toEqual({
      sx: 160,
      sy: 160,
      sw: 320,
      sh: 320,
    });
  });

  it('splits 2×2 into four equal normalized tiles', () => {
    expect(splitGridRects('2x2')).toEqual([
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ]);
  });
});
