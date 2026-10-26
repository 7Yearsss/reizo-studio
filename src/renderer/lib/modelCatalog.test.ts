import { expect, it } from 'vitest';
import { groupModels } from './modelCatalog';
import { modelVendorDomain } from '../../shared/providers';

it('groups gateway routing labels and vendor namespaces without changing the request model ID', () => {
  const options = ['[满血G]gemini-3.6-flash', 'google/gemini-3-pro', 'anthropic/claude-sonnet-4', 'gpt-6-astra', 'local-chat']
    .map((id) => ({ id, name: id, value: id }));
  const groups = groupModels(options);
  expect(groups.map((group) => group.name)).toEqual(['OpenAI', 'Anthropic', 'Google', '其他模型']);
  expect(groups.find((group) => group.name === 'Google')?.models.map((model) => model.id))
    .toEqual(['[满血G]gemini-3.6-flash', 'google/gemini-3-pro']);
  expect(modelVendorDomain('【高速】[路由]claude-opus-4')).toBe('anthropic.com');
});

it('searches vendor names and retains duplicate models offered by different providers', () => {
  const options = [
    { id: 'gemini-flash', name: 'Gemini Flash', value: 'account:gemini', source: 'Reizo 账号' },
    { id: 'gemini-flash', name: 'Gemini Flash', value: 'manual:gemini', source: '手动接入' },
    { id: 'claude-sonnet', name: 'Claude Sonnet', value: 'account:claude' },
  ];
  expect(groupModels(options, 'google')[0].models).toHaveLength(2);
  expect(groupModels(options, '手动接入')[0].models[0].value).toBe('manual:gemini');
  expect(groupModels(options, 'does-not-exist')).toEqual([]);
});
