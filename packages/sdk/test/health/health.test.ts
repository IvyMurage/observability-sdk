import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { HealthController } from '../../src/health/health.controller';
import { OBSERVABILITY_CONFIG } from '../../src/core/constants';
import { resolveConfig } from '../../src/core/config';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const config = resolveConfig({ serviceName: 'test-health' });

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: OBSERVABILITY_CONFIG, useValue: config }],
    }).compile();

    controller = module.get(HealthController);
  });

  it('should return health status', () => {
    const result = controller.health();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('test-health');
    expect(result.environment).toBe('test');
    expect(result.timestamp).toBeDefined();
    expect(typeof result.uptime).toBe('number');
  });

  it('should return ready status', () => {
    const result = controller.ready();
    expect(result.status).toBe('ok');
  });

  it('should return live status', () => {
    const result = controller.live();
    expect(result.status).toBe('ok');
  });
});
