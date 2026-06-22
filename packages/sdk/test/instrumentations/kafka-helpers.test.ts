import { describe, it, expect } from 'vitest';
import { injectKafkaHeaders, withKafkaContext } from '../../src/instrumentations/kafka';

describe('kafka helpers', () => {
  describe('injectKafkaHeaders', () => {
    it('should return headers object', () => {
      const headers = injectKafkaHeaders();
      expect(headers).toBeDefined();
      expect(typeof headers).toBe('object');
    });

    it('should preserve existing headers', () => {
      const headers = injectKafkaHeaders({ 'x-custom': 'value' });
      expect(headers['x-custom']).toBe('value');
    });
  });

  describe('withKafkaContext', () => {
    it('should execute fn and return result', async () => {
      const result = await withKafkaContext({}, 'test-span', async () => {
        return 'done';
      });
      expect(result).toBe('done');
    });

    it('should handle undefined headers', async () => {
      const result = await withKafkaContext(undefined, 'test-span', async () => {
        return 42;
      });
      expect(result).toBe(42);
    });

    it('should propagate errors', async () => {
      await expect(
        withKafkaContext({}, 'error-span', async () => {
          throw new Error('kafka error');
        }),
      ).rejects.toThrow('kafka error');
    });
  });
});
