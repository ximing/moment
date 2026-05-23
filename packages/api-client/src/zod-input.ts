import type { ZodType } from 'zod';

/** z.input<T> 的可选键保留 optional，但整体可赋值给 parse 入参的形态。 */
export type ZodInput<T extends ZodType> = T extends ZodType<infer _O, infer _D, infer I> ? I : never;
