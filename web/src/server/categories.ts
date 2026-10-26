import { z } from 'zod';

export const CategoryBody = z.object({
  code: z.string().regex(/^[a-z0-9_-]+$/).max(40),
  name: z.string().min(1).max(20),
  description: z.string().max(500).optional(),
  form: z.array(
    z.object({
      key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
      label: z.string().min(1).max(100),
      required: z.boolean().optional(),
    }),
  ),
  integrationId: z.string().nullable().optional(),
  autoCreateJob: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
