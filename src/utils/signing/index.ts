/**
 * Public API for the post-quantum signing module.
 * Consumed by the DApp approval modal (RPC dispatch) and tests.
 */

export {
  SCHEME_VERSION_MSG,
  SCHEME_VERSION_TYPED,
  SCHEME_TAG_MSG,
  SCHEME_TAG_TYPED,
  DIGEST_LEN,
} from './ctx';

export { computeMessageDigest } from './messageDigest';

export {
  encodeType,
  typeHash,
  hashStruct,
  encodeField,
  computeTypedDataDigest,
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
