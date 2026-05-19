import { describe, it, expect } from 'vitest';
import { httpInstrumentation } from '../../src/instrumentations/http';
import { kafkaInstrumentation } from '../../src/instrumentations/kafka';
import { redisInstrumentation } from '../../src/instrumentations/redis';
import { mysqlInstrumentation } from '../../src/instrumentations/mysql';
import { pgInstrumentation } from '../../src/instrumentations/pg';

describe('instrumentations', () => {
  describe('httpInstrumentation', () => {
    it('should return plugin with name "http"', () => {
      const plugin = httpInstrumentation();
      expect(plugin.name).toBe('http');
    });

    it('should return OTel instrumentation instance', () => {
      const plugin = httpInstrumentation();
      const inst = plugin.otelInstrumentation!();
      expect(inst).toBeDefined();
    });

    it('should accept options', () => {
      const plugin = httpInstrumentation({
        ignoreIncomingPaths: ['/health', '/metrics'],
        ignoreOutgoingUrls: [/localhost/],
      });
      expect(plugin.name).toBe('http');
      const inst = plugin.otelInstrumentation!();
      expect(inst).toBeDefined();
    });
  });

  describe('kafkaInstrumentation', () => {
    it('should return plugin with name "kafka"', () => {
      const plugin = kafkaInstrumentation();
      expect(plugin.name).toBe('kafka');
    });

    it('should handle missing OTel kafka package gracefully', () => {
      const plugin = kafkaInstrumentation();
      const inst = plugin.otelInstrumentation!();
      // Returns null if @opentelemetry/instrumentation-kafkajs not installed
      expect(inst === null || inst !== undefined).toBe(true);
    });
  });

  describe('redisInstrumentation', () => {
    it('should return plugin with name "redis"', () => {
      const plugin = redisInstrumentation();
      expect(plugin.name).toBe('redis');
    });

    it('should handle missing OTel redis package gracefully', () => {
      const plugin = redisInstrumentation();
      const inst = plugin.otelInstrumentation!();
      expect(inst === null || inst !== undefined).toBe(true);
    });
  });

  describe('mysqlInstrumentation', () => {
    it('should return plugin with name "mysql"', () => {
      const plugin = mysqlInstrumentation();
      expect(plugin.name).toBe('mysql');
    });

    it('should handle missing OTel mysql package gracefully', () => {
      const plugin = mysqlInstrumentation();
      const inst = plugin.otelInstrumentation!();
      expect(inst === null || inst !== undefined).toBe(true);
    });
  });

  describe('pgInstrumentation', () => {
    it('should return plugin with name "pg"', () => {
      const plugin = pgInstrumentation();
      expect(plugin.name).toBe('pg');
    });

    it('should handle missing OTel pg package gracefully', () => {
      const plugin = pgInstrumentation();
      const inst = plugin.otelInstrumentation!();
      expect(inst === null || inst !== undefined).toBe(true);
    });
  });
});
