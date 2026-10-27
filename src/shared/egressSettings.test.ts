import { describe, expect, it } from 'vitest';
import { normalizeEgress, withAllowedHost } from './egressSettings';

describe('egress settings', () => {
  it('defaults to off and keeps only valid, new, unique rules', () => {
    expect(normalizeEgress(null)).toEqual({ enabled: false, allow: [], allowPrivate: false });
    const s = normalizeEgress({ enabled: true, allow: ['API.example.com', 'api.example.com', 'bad host', 'github.com', 42, '*.corp.io'], allowPrivate: 'yes' });
    expect(s).toEqual({ enabled: true, allow: ['api.example.com', '*.corp.io'], allowPrivate: false });
  });
  it('adds a blocked host once and ignores junk', () => {
    const s = withAllowedHost(normalizeEgress({ enabled: true }), 'cdn.example.com');
    expect(s.allow).toEqual(['cdn.example.com']);
    expect(withAllowedHost(s, 'cdn.example.com').allow).toEqual(['cdn.example.com']);
    expect(withAllowedHost(s, 'x y').allow).toEqual(['cdn.example.com']);
  });
});
