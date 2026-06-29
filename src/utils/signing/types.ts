/**
 * Zod schemas for the two signing-method requests. These are exercised at
 * the RPC dispatch boundary in DAppApprovalModal so malformed dApp input
 * never reaches the encoders.
 *
 * Atomic type validation lives inside typedData.ts (where it must, since
 * it parses arrays and references), so the payload schema here only
 * constrains the surface shape.
 */

import { z } from 'zod';
import { DEFAULT_ADDRESS_FORMAT } from '@/config/addressFormat';

const QAddressSchema = z.string().regex(DEFAULT_ADDRESS_FORMAT.fullRegex, {
  message: `must be a Q-prefixed ${DEFAULT_ADDRESS_FORMAT.byteLen}-byte hex address`,
});

const HexBytesSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, { message: 'must be 0x-prefixed even-length hex bytes' });

export const SignMessageParamsSchema = z.tuple([QAddressSchema, HexBytesSchema]);

const TypedFieldSchema = z.object({
  name: z.string().min(1, { message: 'field name required' }),
  type: z.string().min(1, { message: 'field type required' }),
});

const StructDefSchema = z.array(TypedFieldSchema).min(1, { message: 'struct must have ≥1 field' });

const TypedDataPayloadSchema = z.object({
  types: z.record(z.string().min(1), StructDefSchema),
  primaryType: z.string().min(1),
  domain: z.record(z.string(), z.unknown()),
  message: z.record(z.string(), z.unknown()),
});

export const SignTypedDataParamsSchema = z.tuple([QAddressSchema, TypedDataPayloadSchema]);

export type SignMessageParams = z.infer<typeof SignMessageParamsSchema>;
export type SignTypedDataParams = z.infer<typeof SignTypedDataParamsSchema>;
