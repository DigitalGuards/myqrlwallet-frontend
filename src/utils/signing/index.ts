/**
 * Public API for the post-quantum signing module.
 * Consumed by the DApp approval modal (RPC dispatch) and tests.
 */

export {
  SCHEME_VERSION_MSG,
  SCHEME_VERSION_TYPED,
  SCHEME_VERSION_TYPED_V2,
  SCHEME_TAG_MSG,
  SCHEME_TAG_TYPED,
  SCHEME_TAG_TYPED_V2,
  DIGEST_LEN,
  type TypedDataSchemeVersion,
} from './ctx';

export { computeMessageDigest } from './messageDigest';

export {
  encodeType,
  typeHash,
  hashStruct,
  encodeField,
  computeTypedDataDigest,
  typedDataSchemeVersion,
  TYPED_DATA_LIMITS,
  type TypedDataPayload,
  type TypeMap,
  type StructDef,
  type TypedField,
} from './typedData';

export {
  signWithScheme,
  signMessage,
  signTypedData,
  type SignWithSchemeParams,
  type SignWithSchemeResult,
  type SignMessageResult,
  type SignTypedDataResult,
} from './sign';

export {
  verifyMessage,
  verifyTypedData,
  type VerifyMessageParams,
  type VerifyTypedDataParams,
} from './verify';

export {
  SignMessageParamsSchema,
  SignTypedDataParamsSchema,
  type SignMessageParams,
  type SignTypedDataParams,
} from './types';

export { bytesToHex, hexToBytes, concatBytes, concatBytesArr } from './bytes';
