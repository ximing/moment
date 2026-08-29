import { BadRequestError, Body, Delete, JsonController, Param, Post, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import { z } from 'zod';
import { config } from '../config.js';
import { deleteVectorsByMomentId, upsertMomentVector } from '../lancedb/repository.js';
import { baAuth } from './ba-auth.js';
import { embeddingUpsertSchema } from './internal.schema.js';

@JsonController('/internal/embeddings')
@Service()
export class InternalEmbeddingsController {
  @Post('/')
  @UseBefore(baAuth)
  async upsert(@Body() body: unknown): Promise<{ ok: true }> {
    const input = embeddingUpsertSchema.parse(body);
    if (input.vector.length !== config.MULTIMODAL_EMBEDDING_DIMENSION) {
      throw new BadRequestError('EMBEDDING_DIM_MISMATCH');
    }
    await upsertMomentVector(input);
    return { ok: true };
  }

  @Delete('/:momentId')
  @UseBefore(baAuth)
  async remove(@Param('momentId') momentId: string): Promise<{ deleted: number }> {
    z.string().uuid().parse(momentId);
    const deleted = await deleteVectorsByMomentId(momentId);
    return { deleted };
  }
}
