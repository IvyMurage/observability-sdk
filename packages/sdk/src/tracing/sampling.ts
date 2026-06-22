import {
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import type { Sampler } from '@opentelemetry/sdk-trace-base';
import type { SamplingConfig } from '../core/types';

export function createSampler(config: SamplingConfig): Sampler {
  const ratio = config.ratio ?? 1;

  switch (config.type) {
    case 'always':
      return new AlwaysOnSampler();
    case 'never':
      return new AlwaysOffSampler();
    case 'probabilistic':
      return new TraceIdRatioBasedSampler(ratio);
    case 'parent-based':
      return new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(ratio),
      });
    default:
      return new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(ratio),
      });
  }
}
