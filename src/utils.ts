import { BaseApiratorjsError } from "./errors";
import { TServiceToken, TServiceTokenType } from "./types";

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

  throw new BaseApiratorjsError("Unknown token type");
}

export function normalizeTagToCompatibleFormat(tag?: string): string {
  if (!tag) {
    return "default";
  }

  return tag.toLowerCase();
}
