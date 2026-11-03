import { z } from 'zod/v4';
export declare function record<V extends z.ZodType>(valueType: V): z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodRecord<z.ZodString, V>> & { readonly keyType: z.ZodString; readonly valueType: V };
export declare function record<K extends z.core.$ZodRecordKey, V extends z.ZodType>(keyType: K, valueType: V): z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodRecord<K, V>> & { readonly keyType: K; readonly valueType: V };
