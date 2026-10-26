import { describe, expect, it } from 'vitest';
import { buildSearchRequest, configProblem, formatSearchResults, parseSearchResponse } from './webSearch';

describe('web search config', () => {
  it('says what is missing', () => {
    expect(configProblem(null)).toContain('还没有配置');
    expect(configProblem({ provider: 'searxng' })).toContain('地址');
    expect(configProblem({ provider: 'searxng', baseUrl: 'ftp://x' })).toContain('地址');
    expect(configProblem({ provider: 'brave' })).toContain('API Key');
    expect(configProblem({ provider: 'tavily', apiKey: ' ' })).toContain('API Key');
    expect(configProblem({ provider: 'searxng', baseUrl: 'http://localhost:8080' })).toBeNull();
    expect(configProblem({ provider: 'brave', apiKey: 'k' })).toBeNull();
  });
});

describe('requests', () => {
  it('searxng: base url + json format, trailing slash tolerated', () => {
    const req = buildSearchRequest({ provider: 'searxng', baseUrl: 'http://localhost:8080/' }, '电商 主图');
    expect(req.url).toBe('http://localhost:8080/search?q=%E7%94%B5%E5%95%86+%E4%B8%BB%E5%9B%BE&format=json');
  });
  it('brave: token header and count', () => {
    const req = buildSearchRequest({ provider: 'brave', apiKey: 'K' }, 'cats', 3);
    expect(req.url).toContain('q=cats');
    expect(req.url).toContain('count=3');
    expect((req.init.headers as Record<string, string>)['X-Subscription-Token']).toBe('K');
  });
  it('tavily: bearer auth, JSON body', () => {
    const req = buildSearchRequest({ provider: 'tavily', apiKey: 'T' }, 'cats', 4);
    expect(req.init.method).toBe('POST');
    expect((req.init.headers as Record<string, string>).authorization).toBe('Bearer T');
    expect(JSON.parse(String(req.init.body))).toEqual({ query: 'cats', max_results: 4 });
  });
});

describe('responses', () => {
  it('normalises each provider and drops non-http links', () => {
    expect(parseSearchResponse('searxng', { results: [{ title: 'A', url: 'https://a.com', content: 'a  b' }, { title: 'bad', url: 'javascript:1' }] })).toEqual([{ title: 'A', url: 'https://a.com', snippet: 'a b' }]);
    expect(parseSearchResponse('brave', { web: { results: [{ title: 'B', url: 'https://b.com', description: 'desc' }] } })[0]).toMatchObject({ url: 'https://b.com', snippet: 'desc' });
    expect(parseSearchResponse('tavily', { results: [{ title: 'T', url: 'https://t.com', content: 'c' }] })[0].title).toBe('T');
    expect(parseSearchResponse('searxng', null)).toEqual([]);
  });
  it('respects the limit and frames the list as untrusted', () => {
    const many = { results: Array.from({ length: 10 }, (_, i) => ({ title: `t${i}`, url: `https://x.com/${i}`, content: 'c' })) };
    const parsed = parseSearchResponse('searxng', many, 3);
    expect(parsed).toHaveLength(3);
    const text = formatSearchResults('q', parsed);
    expect(text).toContain('untrusted');
    expect(text).toContain('1. t0');
    expect(formatSearchResults('q', [])).toBe('No results for "q".');
  });
});
