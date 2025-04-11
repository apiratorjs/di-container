import { ServiceToken } from "./types";

export class ApiratorjsDependencyError extends Error {
  constructor(message: string, public readonly cause?: string) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class CircularDependencyError extends ApiratorjsDependencyError {
  constructor(token: ServiceToken, public readonly chain: string[]) {
    super(`Circular dependency detected for token ${token.toString()}`, chain.join(" -> "));
  }
}
