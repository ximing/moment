import { Field, FixedSizeList, Float32, Schema, Utf8 } from 'apache-arrow';
import { config } from '../config.js';

export const MOMENT_VECTORS_TABLE = 'moment_vectors';

export function momentVectorsSchema(dim: number = config.MULTIMODAL_EMBEDDING_DIMENSION): Schema {
  return new Schema([
    new Field('id', new Utf8(), false),
    new Field('momentId', new Utf8(), false),
    new Field('chainId', new Utf8(), false),
    new Field('kind', new Utf8(), false),
    new Field('mediaId', new Utf8(), false),
    new Field('vector', new FixedSizeList(dim, new Field('item', new Float32(), false)), false),
    new Field('modelHash', new Utf8(), false),
  ]);
}
