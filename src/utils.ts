import { UnknownTokenTypeError } from "./errors";
import {
  TClassType,
  TNormalizedServiceToken,
  TServiceToken,
  TServiceTokenType,
} from "./types";
import { DEFAULT_TAG } from "./constants";

export function tokenToString(token: TServiceToken): string {
  if (typeof token === "string") return token;
  if (typeof token === "symbol") return token.toString();
  if (typeof token === "function") return token.name;
  return "unknown token";
}

export function tokenToType(token: TServiceToken): TServiceTokenType {
  if (typeof token === "string") {
    return "string";
  }
  if (typeof token === "symbol") {
    return "symbol";
  }
  if (typeof token === "function") {
    return "class";
  }

  throw new UnknownTokenTypeError(token);
}

export function normalizeTagToCompatibleFormat(tag?: string): string {
  if (!tag) {
    return DEFAULT_TAG;
  }

  return tag.toLowerCase();
}

export function isClass(v: any): boolean {
  return (
    typeof v === "function" &&
    /^class\s/.test(Function.prototype.toString.call(v))
  );
}

export function isFunction(v: any): boolean {
  return typeof v === "function";
}

export function normalizeToken(token: TServiceToken): TNormalizedServiceToken {
  if (isClass(token)) {
    return `class ${(token as TClassType<any>).name}`;
  }

  return token as TNormalizedServiceToken;
}
