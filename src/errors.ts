import { ServiceToken } from "./types";

abstract class BaseApiratorjsError extends Error {
  constructor(message: string, public readonly cause?: string) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class CircularDependencyError extends BaseApiratorjsError {
  constructor(token: ServiceToken, public readonly chain: string[]) {
    super(
      `Circular dependency detected for token ${token.toString()}`,
      chain.join(" -> ")
    );
  }
}

export class UnregisteredDependencyError extends BaseApiratorjsError {
  constructor(token: ServiceToken, public readonly cause?: string) {
    super(`Service for token ${token.toString()} is not registered`, cause);
  }
}

export class RequestScopeResolutionError extends BaseApiratorjsError {
  constructor(token: ServiceToken, public readonly cause?: string) {
    super(
      `Cannot resolve request-scoped service for token '${token.toString()}' outside of a request scope. It is likely that a singleton or transient service is trying to inject a request-scoped dependency.`,
      cause
    );
  }
}
