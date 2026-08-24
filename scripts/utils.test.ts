import { describe, it, expect } from 'vitest';
import { assertRequiredAddresses } from './utils';

describe('assertRequiredAddresses', () => {
  it('passes when all addresses are non-empty, non-placeholder values', () => {
    expect(() =>
      assertRequiredAddresses({
        BLEND_POOL: 'CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF',
        vault: 'CA1234567890123456789012345678901234567890123456789012',
      })
    ).not.toThrow();
  });

  it('throws when BLEND_POOL is missing (undefined)', () => {
    expect(() => assertRequiredAddresses({ BLEND_POOL: undefined })).toThrow(/BLEND_POOL is missing/);
  });

  it('throws when a required address is an empty string', () => {
    expect(() => assertRequiredAddresses({ marketplace: '' })).toThrow(/marketplace is missing\/empty/);
  });

  it('throws when a required address is whitespace only', () => {
    expect(() => assertRequiredAddresses({ tokenizer: '   ' })).toThrow(/tokenizer is missing\/empty/);
  });

  it('throws when a required address is a zero address', () => {
    expect(() =>
      assertRequiredAddresses({ vault: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
    ).toThrow(/zero\/burn address/);
  });

  it('throws when a required address is a placeholder value', () => {
    expect(() => assertRequiredAddresses({ sy_wrapper: 'PLACEHOLDER' })).toThrow(/placeholder value/);
    expect(() => assertRequiredAddresses({ pool: 'TODO' })).toThrow(/placeholder value/);
  });

  it('reports every missing address, not just the first', () => {
    try {
      assertRequiredAddresses({ a: undefined, b: '', c: 'ok' });
      throw new Error('expected assertRequiredAddresses to throw');
    } catch (e: any) {
      expect(e.message).toMatch(/a is missing\/empty/);
      expect(e.message).toMatch(/b is missing\/empty/);
      expect(e.message).not.toMatch(/^c/m);
    }
  });
});
