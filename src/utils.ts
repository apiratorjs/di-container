import { ServiceToken } from "./types";

export function tokenToString(token: ServiceToken): string {
  if (typeof token === "string") return token;
  if (typeof token === "symbol") return token.toString();
  if (typeof token === "function") return token.name;
  return "unknown token";
}
