import type { DAppTranslator } from "./dappMessage";

/** Wallet-owned encoder/schema reasons only. Names, paths and values remain data. */
export function signingMessage(message: string, t: DAppTranslator): string {
  switch (message) {
    case "Invalid input":
      return t("dapps:schemaInvalid");
    case "Invalid key in record":
      return t("dapps:schemaRecordKey");
    case "must be a valid QIP-55 Q-prefixed 64-byte address":
      return t("dapps:validAddress");
    case "must be 0x-prefixed even-length hex bytes":
      return t("dapps:validHex");
    case "field name required":
      return t("dapps:fieldNameRequired");
    case "field type required":
      return t("dapps:fieldTypeRequired");
    case "struct must have \u22651 field":
      return t("dapps:structFieldRequired");
    case "invalid typed data payload":
      return t("dapps:invalidPayload");
    case "typed data payload contains unknown top-level fields":
      return t("dapps:unknownTopFields");
    case "typed data types must be a struct map":
      return t("dapps:typesMap");
    case "typed data primaryType must be a string":
      return t("dapps:primaryString");
    case "typed data domain must be an object":
      return t("dapps:domainObject");
    case "typed data message must be an object":
      return t("dapps:messageObject");
    case "typed data contains too many encoded values":
      return t("dapps:tooManyValues");
    case "typed data contains too many fields":
      return t("dapps:tooManyFields");
    case "typed data object contains too many fields":
      return t("dapps:objectFields");
    case "qrl_signTypedData v1 does not support QIP-55 address fields":
      return t("dapps:v1Address");
    case "string field exceeds typed data byte limit":
      return t("dapps:stringLimit");
    case "bytes field exceeds typed data byte limit":
      return t("dapps:bytesLimit");
    case "QRLDomain type is required":
      return t("dapps:domainRequired");
    case "QRLDomain.name is required":
      return t("dapps:domainNameRequired");
    case "QRLDomain cannot be the primary type":
      return t("dapps:domainPrimary");
  }
  const schemaType = /^Invalid input: expected (.*), received (.*)$/s.exec(
    message,
  );
  if (schemaType)
    return t("dapps:schemaType", {
      expected: schemaType[1],
      received: schemaType[2],
    });
  if (message.startsWith("Unrecognized key: "))
    return t("dapps:schemaUnrecognizedKey", { keys: message.slice(18) });
  if (message.startsWith("Unrecognized keys: "))
    return t("dapps:schemaUnrecognizedKeys", { keys: message.slice(19) });
  const smallString =
    /^Too small: expected string to have (>=?)(\d+) characters$/.exec(message);
  if (smallString)
    return t("dapps:schemaSmallString", {
      bound: smallString[1],
      count: Number(smallString[2]),
    });
  const smallArray =
    /^Too small: expected array to have (>=?)(\d+) items$/.exec(message);
  if (smallArray)
    return t("dapps:schemaSmallArray", {
      bound: smallArray[1],
      count: Number(smallArray[2]),
    });
  const largeArray = /^Too big: expected array to have (<=?)(\d+) items$/.exec(
    message,
  );
  if (largeArray)
    return t("dapps:schemaLargeArray", {
      bound: largeArray[1],
      count: Number(largeArray[2]),
    });
  if (message.startsWith("field type too long: "))
    return t("dapps:fieldTypeLong", { value: message.slice(21) });
  if (message.startsWith("invalid int width: "))
    return t("dapps:intWidth", { value: message.slice(19) });
  if (message.startsWith("invalid bytesN width: "))
    return t("dapps:bytesWidth", { value: message.slice(22) });
  if (message.startsWith("invalid array size: "))
    return t("dapps:arraySize", { value: message.slice(20) });
  if (message.startsWith("unknown type: "))
    return t("dapps:unknownType", { value: message.slice(14) });
  if (message.startsWith("unknown primary type: "))
    return t("dapps:unknownPrimary", { value: message.slice(22) });
  if (message.startsWith("struct name is reserved by an atomic type: "))
    return t("dapps:reservedStruct", { value: message.slice(43) });
  if (message.startsWith("empty or invalid struct: "))
    return t("dapps:invalidStruct", { value: message.slice(25) });
  if (message.startsWith("bad field in "))
    return t("dapps:badField", { value: message.slice(13) });
  if (message.startsWith("bad field type in "))
    return t("dapps:badFieldType", { value: message.slice(18) });
  if (message.startsWith("encodeType: missing type definition for "))
    return t("dapps:missingType", { value: message.slice(40) });
  if (message.startsWith("invalid Q-address: "))
    return t("dapps:invalidQAddress", { value: message.slice(19) });
  if (message.startsWith("struct field expects object: "))
    return t("dapps:structObject", { value: message.slice(29) });
  if (message.startsWith("address field expects string: "))
    return t("dapps:addressString", { value: message.slice(30) });
  if (message.startsWith("bool field expects boolean: "))
    return t("dapps:boolBoolean", { value: message.slice(28) });
  if (message.startsWith("string field expects string: "))
    return t("dapps:stringString", { value: message.slice(29) });
  if (message.startsWith("bytes field expects 0x-hex string: "))
    return t("dapps:bytesHex", { value: message.slice(35) });
  if (message.startsWith("array field expects array: "))
    return t("dapps:arrayArray", { value: message.slice(27) });
  if (message.startsWith("unknown struct: "))
    return t("dapps:unknownStruct", { value: message.slice(16) });
  if (message.startsWith("missing field "))
    return t("dapps:missingField", { value: message.slice(14) });
  if (message.startsWith("unused referenced type: "))
    return t("dapps:unusedType", { value: message.slice(24) });
  if (message.startsWith("invalid struct name: "))
    return t("dapps:invalidStructName", { value: message.slice(21) });
  if (message.startsWith("invalid primary type: "))
    return t("dapps:invalidPrimary", { value: message.slice(22) });
  const typeCount = /^typed data must contain 1-(\d+) struct types$/.exec(
    message,
  );
  if (typeCount) return t("dapps:typeCount", { limit: typeCount[1] });
  const duplicateField = /^duplicate field "(.*)" in (.*)$/s.exec(message);
  if (duplicateField)
    return t("dapps:duplicateField", {
      field: duplicateField[1],
      type: duplicateField[2],
    });
  const invalidFieldName = /^invalid field name in (.*?): (.*)$/s.exec(message);
  if (invalidFieldName)
    return t("dapps:invalidFieldName", {
      type: invalidFieldName[1],
      value: invalidFieldName[2],
    });
  const unknownField = /^unknown field in (.*?): (.*)$/s.exec(message);
  if (unknownField)
    return t("dapps:unknownField", {
      type: unknownField[1],
      field: unknownField[2],
    });
  const intRange = /^((?:u?int)\d+) out of range: (.*)$/s.exec(message);
  if (intRange)
    return t("dapps:intRange", { type: intRange[1], value: intRange[2] });
  const intNegative = /^(uint\d+) negative: (.*)$/s.exec(message);
  if (intNegative)
    return t("dapps:intNegative", {
      type: intNegative[1],
      value: intNegative[2],
    });
  const intLong = /^(u?int\d+) value is too long$/.exec(message);
  if (intLong) return t("dapps:intLong", { type: intLong[1] });
  const intString = /^invalid (u?int\d+) string: (.*)$/s.exec(message);
  if (intString)
    return t("dapps:intString", { type: intString[1], value: intString[2] });
  const intUnsafe = /^unsafe (u?int\d+) number: (.*), pass as string$/s.exec(
    message,
  );
  if (intUnsafe)
    return t("dapps:intUnsafe", { type: intUnsafe[1], value: intUnsafe[2] });
  const intUnsupported = /^unsupported (u?int\d+) value: (.*)$/s.exec(message);
  if (intUnsupported)
    return t("dapps:intUnsupported", {
      type: intUnsupported[1],
      value: intUnsupported[2],
    });
  const bytesNHex = /^(bytes\d+) expects 0x-hex string: (.*)$/s.exec(message);
  if (bytesNHex)
    return t("dapps:bytesNHex", { type: bytesNHex[1], value: bytesNHex[2] });
  const bytesNLength = /^(bytes\d+) requires (\d+) bytes$/.exec(message);
  if (bytesNLength)
    return t("dapps:bytesNLength", {
      type: bytesNLength[1],
      expected: bytesNLength[2],
    });
  const bytesNActual = /^(bytes\d+) requires (\d+) bytes, got (\d+)$/.exec(
    message,
  );
  if (bytesNActual)
    return t("dapps:bytesNActual", {
      type: bytesNActual[1],
      expected: bytesNActual[2],
      actual: bytesNActual[3],
    });
  const arrayLimit = /^array (.*) exceeds length limit$/s.exec(message);
  if (arrayLimit) return t("dapps:arrayLimit", { type: arrayLimit[1] });
  const fixedArray =
    /^fixed array (.*) requires length (\d+), got (\d+)$/s.exec(message);
  if (fixedArray)
    return t("dapps:fixedArray", {
      type: fixedArray[1],
      expected: fixedArray[2],
      actual: fixedArray[3],
    });
  const domainField =
    /^QRLDomain field "(.*)" not in reserved set \(name, version, chainId, verifyingContract, salt\)$/s.exec(
      message,
    );
  if (domainField) return t("dapps:domainField", { field: domainField[1] });
  const domainFieldType =
    /^QRLDomain field "(.*)" must be type "(.*)", got "(.*)"$/s.exec(message);
  if (domainFieldType)
    return t("dapps:domainFieldType", {
      field: domainFieldType[1],
      expected: domainFieldType[2],
      actual: domainFieldType[3],
    });
  return message;
}
