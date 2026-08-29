import { z } from 'zod';

export const embeddingUpsertSchema = z
  .object({
    momentId: z.string().uuid(),
    chainId: z.string().uuid(),
    kind: z.enum(['moment', 'image']),
    mediaId: z.string().uuid().optional(),
    vector: z.array(z.number()),
    modelHash: z.string().length(64),
  })
  .superRefine((val, ctx) => {
    if (val.kind === 'image' && !val.mediaId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['mediaId'] });
    }
  });
