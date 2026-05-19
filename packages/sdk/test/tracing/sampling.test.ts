import { describe, it, expect } from 'vitest';
import {
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { createSampler } from '../../src/tracing/sampling';

describe('createSampler', () => {
  it('should create AlwaysOnSampler for "always"', () => {
    const sampler = createSampler({ type: 'always' });
    expect(sampler).toBeInstanceOf(AlwaysOnSampler);
  });

  it('should create AlwaysOffSampler for "never"', () => {
    const sampler = createSampler({ type: 'never' });
    expect(sampler).toBeInstanceOf(AlwaysOffSampler);
  });

  it('should create TraceIdRatioBasedSampler for "probabilistic"', () => {
    const sampler = createSampler({ type: 'probabilistic', ratio: 0.5 });
    expect(sampler).toBeInstanceOf(TraceIdRatioBasedSampler);
  });

  it('should create ParentBasedSampler for "parent-based"', () => {
    const sampler = createSampler({ type: 'parent-based', ratio: 0.1 });
    expect(sampler).toBeInstanceOf(ParentBasedSampler);
  });

  it('should default to ParentBasedSampler', () => {
    const sampler = createSampler({});
    expect(sampler).toBeInstanceOf(ParentBasedSampler);
  });
});
