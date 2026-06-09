import { describe, expect, it } from 'vitest';
import { parseAgentConfig } from '../src/config/loadConfig.js';

describe('parseAgentConfig', () => {
  it('parses a valid config', () => {
    expect(
      parseAgentConfig({
        targetUrl: 'https://example.com/dashboard',
        periods: ['1d', '7d', '30d'],
        preferredPageSize: 100,
        outputDir: 'output',
        browserProfileDir: '.browser-profile',
        goodsExportUrl: 'https://example.com/goods',
      }),
    ).toEqual({
      targetUrl: 'https://example.com/dashboard',
      periods: ['1d', '7d', '30d'],
      preferredPageSize: 100,
      outputDir: 'output',
      browserProfileDir: '.browser-profile',
      goodsExportUrl: 'https://example.com/goods',
    });
  });

  it('parses optional exposure url', () => {
    expect(
      parseAgentConfig({
        targetUrl: 'https://example.com/dashboard',
        exposureUrl: 'https://example.com/exposure',
        periods: ['1d', '7d', '30d'],
        preferredPageSize: 100,
        outputDir: 'output',
        browserProfileDir: '.browser-profile',
      }),
    ).toMatchObject({
      exposureUrl: 'https://example.com/exposure',
    });
  });

  it('rejects unsupported periods', () => {
    expect(() =>
      parseAgentConfig({
        targetUrl: 'https://example.com/dashboard',
        periods: ['2d'],
        preferredPageSize: 100,
        outputDir: 'output',
        browserProfileDir: '.browser-profile',
      }),
    ).toThrow('Unsupported period: 2d');
  });
});
