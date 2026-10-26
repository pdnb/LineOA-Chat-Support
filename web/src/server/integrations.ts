import { randomBytes } from 'crypto';
import { z } from 'zod';

export const IntegrationBody = z.object({
  name: z.string().min(1).max(100),
  endpointUrl: z.url({ protocol: /^https?$/ }),
  secret: z.string().min(16).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  isActive: z.boolean().optional(),
});

export const newSecret = () => randomBytes(24).toString('hex');
