import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod/v4";
export declare namespace Realtime {
    type ChannelInput = string | Realtime.ChannelInstance;
    namespace Subscribe {
        interface Token<TChannel extends Realtime.ChannelInput = Realtime.ChannelInput, TTopics extends string[] = string[]> {
            key?: string | undefined;
            channel: TChannel;
            topics: TTopics;
            apiBaseUrl?: string;
        }
        interface ClientToken {
            key: string;
            apiBaseUrl?: string;
        }
        type InferTopicSubscribeData<TTopic> = TTopic extends Realtime.TopicConfig ? Realtime.InferTopicData<TTopic> : any;
        type StreamSubscription<TSubscribeToken extends Token = Token, TData extends Simplify<Token.InferMessage<TSubscribeToken>> = Simplify<Token.InferMessage<TSubscribeToken>>> = ReadableStream<TData> & {
            /**
             * Get a new readable stream from the subscription that delivers JSON chunks.
             *
             * The stream starts when this function is called and will not contain any
             * messages that were sent before this function was called.
             */
            getJsonStream(): ReadableStream<TData>;
            /**
             * Get a new readable stream from the subscription that delivers
             * SSE-compatible chunks, which are compatible with the `EventSource` API
             * and generally used for streaming data from a server to the browser.
             *
             * The stream starts when this function is called and will not contain any
             * messages that were sent before this function was called.
             */
            getEncodedStream(): ReadableStream<Uint8Array>;
            /**
             * Close the underlying subscription connection.
             */
            close(reason?: string): void;
            /**
             * Alias for `close()` to match callback-style subscription semantics.
             */
            unsubscribe(reason?: string): void;
        };
        type Callback<TSubscribeToken extends Subscribe.Token = Subscribe.Token> = (message: Token.InferMessage<TSubscribeToken>) => MaybePromise<void>;
        type CallbackSubscription = {
            close(reason?: string): void;
            unsubscribe(reason?: string): void;
        };
        namespace Token {
            type InferChannel<TToken extends Token> = TToken extends Token<infer IChannel, any> ? IChannel : Realtime.ChannelInput;
            type InferTopicData<TToken extends Token, TChannelTopics extends Record<string, unknown> = Channel.InferTopics<Token.InferChannel<TToken>>> = TToken extends Token<any, infer ITopics> ? {
                [K in ITopics[number]]: TChannelTopics[K];
            } : never;
            type InferMessage<TToken extends Token> = Simplify<Realtime.Message<Channel.InferId<Token.InferChannel<TToken>>, Token.InferTopicData<TToken>>>;
        }
    }
    const messageSchema: z.ZodPipe<z.ZodObject<{
        channel: z.ZodOptional<z.ZodString>;
        topic: z.ZodOptional<z.ZodString>;
        data: z.ZodOptional<z.ZodAny>;
        run_id: z.ZodOptional<z.ZodString>;
        fn_id: z.ZodOptional<z.ZodString>;
        created_at: z.ZodOptional<z.ZodPipe<z.ZodOptional<z.ZodString>, z.ZodTransform<Date | undefined, string | undefined>>>;
        env_id: z.ZodOptional<z.ZodString>;
        stream_id: z.ZodOptional<z.ZodString>;
        kind: z.ZodEnum<{
            sub: "sub";
            data: "data";
            closing: "closing";
            event: "event";
            run: "run";
            "datastream-start": "datastream-start";
            "datastream-end": "datastream-end";
            chunk: "chunk";
            step: "step";
            ping: "ping";
            pong: "pong";
            unsub: "unsub";
        }>;
    }, z.core.$strip>, z.ZodTransform<{
        data: any;
        kind: "sub" | "data" | "closing" | "event" | "run" | "datastream-start" | "datastream-end" | "chunk" | "step" | "ping" | "pong" | "unsub";
        channel?: string | undefined;
        topic?: string | undefined;
        run_id?: string | undefined;
        fn_id?: string | undefined;
        created_at?: Date | undefined;
        env_id?: string | undefined;
        stream_id?: string | undefined;
    }, {
        kind: "sub" | "data" | "closing" | "event" | "run" | "datastream-start" | "datastream-end" | "chunk" | "step" | "ping" | "pong" | "unsub";
        channel?: string | undefined;
        topic?: string | undefined;
        data?: any;
        run_id?: string | undefined;
        fn_id?: string | undefined;
        created_at?: Date | undefined;
        env_id?: string | undefined;
        stream_id?: string | undefined;
    }>>;
    type Message<TChannelId extends string = string, TTopics extends Record<string, unknown> = Record<string, unknown>> = {
        [K in keyof TTopics]: {
            topic: K;
            channel: TChannelId;
            data: Subscribe.InferTopicSubscribeData<TTopics[K]>;
            runId?: string;
            fnId?: string;
            createdAt: Date;
            envId?: string;
            kind: "data";
        } | {
            topic: K;
            channel: TChannelId;
            data: Subscribe.InferTopicSubscribeData<TTopics[K]>;
            runId?: string;
            fnId?: string;
            kind: "datastream-start" | "datastream-end" | "chunk";
            streamId: string;
            stream: ReadableStream<Subscribe.InferTopicSubscribeData<TTopics[K]>>;
        };
    }[keyof TTopics] | {
        channel?: TChannelId;
        topic?: string;
        data: unknown;
        runId?: string;
        fnId?: string;
        createdAt: Date;
        envId?: string;
        kind: "run";
    };
    namespace Message {
        type Input<TChannelId extends string = string, TTopicId extends string = string, TData = any> = {
            channel: TChannelId;
            topic: TTopicId;
            data: TData;
        };
        type Raw<TChannelId extends string = string, TTopics extends Record<string, unknown> = Record<string, unknown>> = {
            [K in keyof TTopics]: {
                topic?: K;
                stream_id?: string;
                data: Subscribe.InferTopicSubscribeData<TTopics[K]>;
                channel?: TChannelId;
                run_id?: string;
                fn_id?: string;
                created_at?: Date;
                env_id?: string;
                kind: "step" | "run" | "data" | "datastream-start" | "datastream-end" | "ping" | "pong" | "closing" | "event" | "sub" | "unsub" | "chunk";
            };
        }[keyof TTopics];
    }
    namespace Channel {
        type InferId<TChannel extends Realtime.ChannelInstance | Realtime.ChannelDef | string> = TChannel extends Realtime.ChannelInstance<infer IId, Realtime.TopicsConfig> ? IId : TChannel extends Realtime.ChannelDef<infer TNameFn, Realtime.TopicsConfig> ? ReturnType<TNameFn> : TChannel extends string ? TChannel : string;
        type InferTopics<TChannel extends Realtime.ChannelInstance | Realtime.ChannelDef | string> = TChannel extends Realtime.ChannelDef<infer _NameFn, infer ITopics> ? ITopics : TChannel extends Realtime.ChannelInstance<infer _Name, infer ITopics> ? ITopics : TChannel extends string ? Record<string, unknown> : Record<string, unknown>;
    }
    type TopicConfig = {
        schema: StandardSchemaV1;
    };
    type TopicsConfig = Record<string, TopicConfig>;
    type InferTopicData<T extends TopicConfig> = T extends {
        schema: infer S extends StandardSchemaV1;
    } ? StandardSchemaV1.InferInput<S> : unknown;
    interface TopicRef<_TData = unknown> {
        channel: string;
        topic: string;
        config: TopicConfig;
    }
    type TopicAccessors<_TName extends string, TTopics extends TopicsConfig> = {
        [K in string & keyof TTopics]: TopicRef<InferTopicData<TTopics[K]>>;
    };
    type ChannelInstance<TName extends string = string, TTopics extends TopicsConfig = {}> = {
        name: TName;
        topics: TTopics;
    } & TopicAccessors<TName, TTopics>;
    type ChannelDef<TNameFn extends (...args: any[]) => string = (...args: any[]) => string, TTopics extends TopicsConfig = TopicsConfig> = ((...args: Parameters<TNameFn>) => ChannelInstance<ReturnType<TNameFn>, TTopics>) & {
        topics: TTopics;
        $params: Parameters<TNameFn>[0];
    };
    type TypedPublishFn = <TData>(topicRef: TopicRef<TData>, data: TData) => Promise<void>;
}
/**
 * Expects that a value resolves to `true`, useful for asserting type checks.
 */
export type Expect<T extends true> = T;
/**
Returns a boolean for whether the two given types are equal.

{@link https://github.com/microsoft/TypeScript/issues/27024#issuecomment-421529650}
{@link https://stackoverflow.com/questions/68961864/how-does-the-equals-work-in-typescript/68963796#68963796}

Use-cases:
- If you want to make a conditional branch based on the result of a comparison of two types.

@example
```
import type {IsEqual} from 'type-fest';

// This type returns a boolean for whether the given array includes the given item.
// `IsEqual` is used to compare the given array at position 0 and the given item and then return true if they are equal.
type Includes<Value extends readonly any[], Item> =
    Value extends readonly [Value[0], ...infer rest]
        ? IsEqual<Value[0], Item> extends true
            ? true
            : Includes<rest, Item>
        : false;
```
*/
export type IsEqual<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
/**
 * Returns the given generic as either itself or a promise of itself.
 */
export type MaybePromise<T> = T | Promise<T>;
export type Simplify<T> = {
    [KeyType in keyof T]: T[KeyType];
} & {};
