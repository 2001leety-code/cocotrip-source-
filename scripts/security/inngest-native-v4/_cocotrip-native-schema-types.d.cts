import { z as nativeZod } from "zod/v4";
export declare const baseJsonErrorSchema: nativeZod.ZodObject<{
    name: nativeZod.ZodOptional<nativeZod.ZodString>;
    error: nativeZod.ZodOptional<nativeZod.ZodString>;
    message: nativeZod.ZodOptional<nativeZod.ZodString>;
    stack: nativeZod.ZodOptional<nativeZod.ZodString>;
}, nativeZod.core.$strip>;
export declare const maybeJsonErrorSchema: nativeZod.ZodType<{
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
}>;
export type JsonError = nativeZod.infer<typeof baseJsonErrorSchema> & {
    name: string;
    message: string;
    cause?: unknown;
};
export declare const jsonErrorSchema: nativeZod.ZodType<JsonError>;
export declare const incomingOpSchema: nativeZod.ZodObject<{
    id: nativeZod.ZodString;
    data: nativeZod.ZodOptional<nativeZod.ZodAny>;
    error: nativeZod.ZodOptional<nativeZod.ZodAny>;
    input: nativeZod.ZodOptional<nativeZod.ZodAny>;
}, nativeZod.core.$strip>;
export type TimeStr = `${`${number}w` | ""}${`${number}d` | ""}${`${number}h` | ""}${`${number}m` | ""}${`${number}s` | ""}`;
export declare const sendEventResponseSchema: nativeZod.ZodObject<{
    ids: nativeZod.ZodDefault<nativeZod.ZodArray<nativeZod.ZodString>>;
    status: nativeZod.ZodDefault<nativeZod.ZodNumber>;
    error: nativeZod.ZodOptional<nativeZod.ZodString>;
}, nativeZod.core.$strip>;
export declare const concurrencyOptionSchema: nativeZod.ZodObject<{
    limit: nativeZod.ZodNumber;
    key: nativeZod.ZodOptional<nativeZod.ZodString>;
    scope: nativeZod.ZodOptional<nativeZod.ZodEnum<{
        fn: "fn";
        env: "env";
        account: "account";
    }>>;
}, nativeZod.core.$strict>;
export interface ConcurrencyOption {
    /**
     * The concurrency limit for this option, adding a limit on how many concurrent
     * steps can execute at once.
     */
    limit: number;
    /**
     * An optional concurrency key, as an expression using the common expression language
     * (CEL).  The result of this expression is used to create new concurrency groups, or
     * sub-queues, for each function run.
     *
     * The event is passed into this expression as "event".
     *
     * Examples:
     * - `event.data.user_id`:  this evaluates to the user_id in the event.data object.
     * - `event.data.user_id + "-" + event.data.account_id`: creates a new group per user/account
     * - `"ai"`:  references a custom string
     */
    key?: string;
    /**
     * An optional scope for the concurrency group.  By default, concurrency limits are
     * scoped to functions - one function's concurrency limits do not impact other functions.
     *
     * Changing this "scope" allows concurrency limits to work across environments (eg. production
     * vs branch environments) or across your account (global).
     */
    scope?: "fn" | "env" | "account";
}
export declare const functionConfigSchema: nativeZod.ZodObject<{
    name: nativeZod.ZodOptional<nativeZod.ZodString>;
    id: nativeZod.ZodString;
    triggers: nativeZod.ZodArray<nativeZod.ZodUnion<readonly [nativeZod.ZodObject<{
        event: nativeZod.ZodString;
        expression: nativeZod.ZodOptional<nativeZod.ZodString>;
    }, nativeZod.core.$strict>, nativeZod.ZodObject<{
        cron: nativeZod.ZodString;
        jitter: nativeZod.ZodOptional<nativeZod.ZodString>;
    }, nativeZod.core.$strict>]>>;
    steps: nativeZod.ZodPipe<nativeZod.ZodTransform<unknown, unknown>, nativeZod.ZodRecord<nativeZod.ZodString, nativeZod.ZodObject<{
        id: nativeZod.ZodString;
        name: nativeZod.ZodString;
        runtime: nativeZod.ZodObject<{
            type: nativeZod.ZodUnion<readonly [nativeZod.ZodLiteral<"http">, nativeZod.ZodLiteral<"ws">]>;
            url: nativeZod.ZodString;
        }, nativeZod.core.$strict>;
        retries: nativeZod.ZodOptional<nativeZod.ZodObject<{
            attempts: nativeZod.ZodOptional<nativeZod.ZodNumber>;
        }, nativeZod.core.$strict>>;
    }, nativeZod.core.$strict>>> & {
        readonly keyType: nativeZod.ZodString;
        readonly valueType: nativeZod.ZodObject<{
            id: nativeZod.ZodString;
            name: nativeZod.ZodString;
            runtime: nativeZod.ZodObject<{
                type: nativeZod.ZodUnion<readonly [nativeZod.ZodLiteral<"http">, nativeZod.ZodLiteral<"ws">]>;
                url: nativeZod.ZodString;
            }, nativeZod.core.$strict>;
            retries: nativeZod.ZodOptional<nativeZod.ZodObject<{
                attempts: nativeZod.ZodOptional<nativeZod.ZodNumber>;
            }, nativeZod.core.$strict>>;
        }, nativeZod.core.$strict>;
    };
    idempotency: nativeZod.ZodOptional<nativeZod.ZodString>;
    batchEvents: nativeZod.ZodOptional<nativeZod.ZodObject<{
        maxSize: nativeZod.ZodNumber;
        timeout: nativeZod.ZodString;
        key: nativeZod.ZodOptional<nativeZod.ZodString>;
        if: nativeZod.ZodOptional<nativeZod.ZodString>;
    }, nativeZod.core.$strict>>;
    rateLimit: nativeZod.ZodOptional<nativeZod.ZodObject<{
        key: nativeZod.ZodOptional<nativeZod.ZodString>;
        limit: nativeZod.ZodNumber;
        period: nativeZod.ZodPipe<nativeZod.ZodString, nativeZod.ZodTransform<"" | `${number}w` | `${number}d` | `${number}h` | `${number}m` | `${number}s` | `${number}m${number}s` | `${number}h${number}s` | `${number}h${number}m` | `${number}h${number}m${number}s` | `${number}d${number}s` | `${number}d${number}m` | `${number}d${number}m${number}s` | `${number}d${number}h` | `${number}d${number}h${number}s` | `${number}d${number}h${number}m` | `${number}d${number}h${number}m${number}s` | `${number}w${number}s` | `${number}w${number}m` | `${number}w${number}m${number}s` | `${number}w${number}h` | `${number}w${number}h${number}s` | `${number}w${number}h${number}m` | `${number}w${number}h${number}m${number}s` | `${number}w${number}d` | `${number}w${number}d${number}s` | `${number}w${number}d${number}m` | `${number}w${number}d${number}m${number}s` | `${number}w${number}d${number}h` | `${number}w${number}d${number}h${number}s` | `${number}w${number}d${number}h${number}m` | `${number}w${number}d${number}h${number}m${number}s`, string>>;
    }, nativeZod.core.$strict>>;
    throttle: nativeZod.ZodOptional<nativeZod.ZodObject<{
        key: nativeZod.ZodOptional<nativeZod.ZodString>;
        limit: nativeZod.ZodNumber;
        period: nativeZod.ZodPipe<nativeZod.ZodString, nativeZod.ZodTransform<"" | `${number}w` | `${number}d` | `${number}h` | `${number}m` | `${number}s` | `${number}m${number}s` | `${number}h${number}s` | `${number}h${number}m` | `${number}h${number}m${number}s` | `${number}d${number}s` | `${number}d${number}m` | `${number}d${number}m${number}s` | `${number}d${number}h` | `${number}d${number}h${number}s` | `${number}d${number}h${number}m` | `${number}d${number}h${number}m${number}s` | `${number}w${number}s` | `${number}w${number}m` | `${number}w${number}m${number}s` | `${number}w${number}h` | `${number}w${number}h${number}s` | `${number}w${number}h${number}m` | `${number}w${number}h${number}m${number}s` | `${number}w${number}d` | `${number}w${number}d${number}s` | `${number}w${number}d${number}m` | `${number}w${number}d${number}m${number}s` | `${number}w${number}d${number}h` | `${number}w${number}d${number}h${number}s` | `${number}w${number}d${number}h${number}m` | `${number}w${number}d${number}h${number}m${number}s`, string>>;
        burst: nativeZod.ZodOptional<nativeZod.ZodNumber>;
    }, nativeZod.core.$strict>>;
    singleton: nativeZod.ZodOptional<nativeZod.ZodObject<{
        key: nativeZod.ZodOptional<nativeZod.ZodString>;
        mode: nativeZod.ZodEnum<{
            cancel: "cancel";
            skip: "skip";
        }>;
    }, nativeZod.core.$strict>>;
    cancel: nativeZod.ZodOptional<nativeZod.ZodArray<nativeZod.ZodObject<{
        event: nativeZod.ZodString;
        if: nativeZod.ZodOptional<nativeZod.ZodString>;
        timeout: nativeZod.ZodOptional<nativeZod.ZodString>;
    }, nativeZod.core.$strict>>>;
    debounce: nativeZod.ZodOptional<nativeZod.ZodObject<{
        key: nativeZod.ZodOptional<nativeZod.ZodString>;
        period: nativeZod.ZodPipe<nativeZod.ZodString, nativeZod.ZodTransform<"" | `${number}w` | `${number}d` | `${number}h` | `${number}m` | `${number}s` | `${number}m${number}s` | `${number}h${number}s` | `${number}h${number}m` | `${number}h${number}m${number}s` | `${number}d${number}s` | `${number}d${number}m` | `${number}d${number}m${number}s` | `${number}d${number}h` | `${number}d${number}h${number}s` | `${number}d${number}h${number}m` | `${number}d${number}h${number}m${number}s` | `${number}w${number}s` | `${number}w${number}m` | `${number}w${number}m${number}s` | `${number}w${number}h` | `${number}w${number}h${number}s` | `${number}w${number}h${number}m` | `${number}w${number}h${number}m${number}s` | `${number}w${number}d` | `${number}w${number}d${number}s` | `${number}w${number}d${number}m` | `${number}w${number}d${number}m${number}s` | `${number}w${number}d${number}h` | `${number}w${number}d${number}h${number}s` | `${number}w${number}d${number}h${number}m` | `${number}w${number}d${number}h${number}m${number}s`, string>>;
        timeout: nativeZod.ZodOptional<nativeZod.ZodPipe<nativeZod.ZodString, nativeZod.ZodTransform<"" | `${number}w` | `${number}d` | `${number}h` | `${number}m` | `${number}s` | `${number}m${number}s` | `${number}h${number}s` | `${number}h${number}m` | `${number}h${number}m${number}s` | `${number}d${number}s` | `${number}d${number}m` | `${number}d${number}m${number}s` | `${number}d${number}h` | `${number}d${number}h${number}s` | `${number}d${number}h${number}m` | `${number}d${number}h${number}m${number}s` | `${number}w${number}s` | `${number}w${number}m` | `${number}w${number}m${number}s` | `${number}w${number}h` | `${number}w${number}h${number}s` | `${number}w${number}h${number}m` | `${number}w${number}h${number}m${number}s` | `${number}w${number}d` | `${number}w${number}d${number}s` | `${number}w${number}d${number}m` | `${number}w${number}d${number}m${number}s` | `${number}w${number}d${number}h` | `${number}w${number}d${number}h${number}s` | `${number}w${number}d${number}h${number}m` | `${number}w${number}d${number}h${number}m${number}s`, string>>>;
    }, nativeZod.core.$strict>>;
    timeouts: nativeZod.ZodOptional<nativeZod.ZodObject<{
        start: nativeZod.ZodOptional<nativeZod.ZodPipe<nativeZod.ZodString, nativeZod.ZodTransform<"" | `${number}w` | `${number}d` | `${number}h` | `${number}m` | `${number}s` | `${number}m${number}s` | `${number}h${number}s` | `${number}h${number}m` | `${number}h${number}m${number}s` | `${number}d${number}s` | `${number}d${number}m` | `${number}d${number}m${number}s` | `${number}d${number}h` | `${number}d${number}h${number}s` | `${number}d${number}h${number}m` | `${number}d${number}h${number}m${number}s` | `${number}w${number}s` | `${number}w${number}m` | `${number}w${number}m${number}s` | `${number}w${number}h` | `${number}w${number}h${number}s` | `${number}w${number}h${number}m` | `${number}w${number}h${number}m${number}s` | `${number}w${number}d` | `${number}w${number}d${number}s` | `${number}w${number}d${number}m` | `${number}w${number}d${number}m${number}s` | `${number}w${number}d${number}h` | `${number}w${number}d${number}h${number}s` | `${number}w${number}d${number}h${number}m` | `${number}w${number}d${number}h${number}m${number}s`, string>>>;
        finish: nativeZod.ZodOptional<nativeZod.ZodPipe<nativeZod.ZodString, nativeZod.ZodTransform<"" | `${number}w` | `${number}d` | `${number}h` | `${number}m` | `${number}s` | `${number}m${number}s` | `${number}h${number}s` | `${number}h${number}m` | `${number}h${number}m${number}s` | `${number}d${number}s` | `${number}d${number}m` | `${number}d${number}m${number}s` | `${number}d${number}h` | `${number}d${number}h${number}s` | `${number}d${number}h${number}m` | `${number}d${number}h${number}m${number}s` | `${number}w${number}s` | `${number}w${number}m` | `${number}w${number}m${number}s` | `${number}w${number}h` | `${number}w${number}h${number}s` | `${number}w${number}h${number}m` | `${number}w${number}h${number}m${number}s` | `${number}w${number}d` | `${number}w${number}d${number}s` | `${number}w${number}d${number}m` | `${number}w${number}d${number}m${number}s` | `${number}w${number}d${number}h` | `${number}w${number}d${number}h${number}s` | `${number}w${number}d${number}h${number}m` | `${number}w${number}d${number}h${number}m${number}s`, string>>>;
    }, nativeZod.core.$strict>>;
    priority: nativeZod.ZodOptional<nativeZod.ZodObject<{
        run: nativeZod.ZodOptional<nativeZod.ZodString>;
    }, nativeZod.core.$strict>>;
    concurrency: nativeZod.ZodOptional<nativeZod.ZodUnion<readonly [nativeZod.ZodNumber, nativeZod.ZodPipe<nativeZod.ZodObject<{
        limit: nativeZod.ZodNumber;
        key: nativeZod.ZodOptional<nativeZod.ZodString>;
        scope: nativeZod.ZodOptional<nativeZod.ZodEnum<{
            fn: "fn";
            env: "env";
            account: "account";
        }>>;
    }, nativeZod.core.$strict>, nativeZod.ZodTransform<ConcurrencyOption, {
        limit: number;
        key?: string | undefined;
        scope?: "fn" | "env" | "account" | undefined;
    }>>, nativeZod.ZodArray<nativeZod.ZodPipe<nativeZod.ZodObject<{
        limit: nativeZod.ZodNumber;
        key: nativeZod.ZodOptional<nativeZod.ZodString>;
        scope: nativeZod.ZodOptional<nativeZod.ZodEnum<{
            fn: "fn";
            env: "env";
            account: "account";
        }>>;
    }, nativeZod.core.$strict>, nativeZod.ZodTransform<ConcurrencyOption, {
        limit: number;
        key?: string | undefined;
        scope?: "fn" | "env" | "account" | undefined;
    }>>>]>>;
}, nativeZod.core.$strict>;
export declare const inBandSyncRequestBodySchema: nativeZod.ZodObject<{
    url: nativeZod.ZodString;
}, nativeZod.core.$strict>;
