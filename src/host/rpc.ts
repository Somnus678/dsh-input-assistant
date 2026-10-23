import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

export const rpcPayloadSchema = z.strictObject({
  method: z.enum(['status', 'generate', 'cancel', 'drafts/list', 'drafts/save', 'drafts/delete', 'drafts/clear', 'settings/get', 'settings/set']),
  data: z.json(),
})
export type RpcPayload = z.infer<typeof rpcPayloadSchema>

const inputCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-input-assistant#RpcPayload',
  create: () => rpcPayloadSchema,
  jsonSchema: { type: 'object', properties: { method: { type: 'string' }, data: {} }, required: ['method', 'data'], additionalProperties: false },
}

/** Explicit strict codecs let the normal Gateway route our private method. */
export const remoteInfo = createTypertRemoteInfo({
  package: 'dsh-input-assistant',
  methods: {
    'input-assistant/call': {
      service: 'inputAssistant', implementation: 'call', invocation: { kind: 'direct' },
      parameters: [{ name: 'payload', source: 'json', codec: inputCodec, strictCodec: inputCodec }],
      cancellation: { parameter: 'signal' },
      result: { mode: 'strict', typeSymbol: 'dsh-input-assistant#RpcResult', create: () => z.json(), jsonSchema: {} },
    },
  },
}, z)

export const hostContribution = {
  package: 'dsh-input-assistant', face: 'host' as const, schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: remoteInfo.descriptors,
}
