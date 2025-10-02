import { ELifetime, TServiceToken } from "./types";
import { normalizeToken } from "./utils";

export class DependencyInjectionError extends Error {
  constructor(message: string, public readonly cause?: string) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class CircularDependencyError extends DependencyInjectionError {
  constructor(token: TServiceToken, public readonly chain: string[]) {
    const normalizedToken = normalizeToken(token);
    super(
      `Circular dependency detected for token ${normalizedToken.toString()}`,
      chain.join(" -> ")
    );
  }
}

export class UnregisteredDependencyError extends DependencyInjectionError {
  constructor(token: TServiceToken, public readonly cause?: string) {
    const normalizedToken = normalizeToken(token);
    super(
      `Service for token ${normalizedToken.toString()} is not registered`,
      cause
    );
  }
}

export class RequestScopeResolutionError extends DependencyInjectionError {
  constructor(token: TServiceToken, public readonly cause?: string) {
    const normalizedToken = normalizeToken(token);
    super(
      `Cannot resolve request-scoped service for token '${normalizedToken.toString()}' outside of a request scope. It is likely that a singleton or transient service is trying to inject a request-scoped dependency.`,
      cause
    );
  }
}

export class CrossLifecycleRegistrationError extends DependencyInjectionError {
  constructor(
    token: TServiceToken,
    public readonly existingLifecycle: string,
    public readonly attemptedLifecycle: string,
    public readonly cause?: string
  ) {
    const normalizedToken = normalizeToken(token);
    super(
      `Cannot register token '${normalizedToken.toString()}' as ${attemptedLifecycle} because it is already registered as ${existingLifecycle}. Cross-lifecycle registration is not allowed.`,
      cause
    );
  }
}

export class UnknownTokenTypeError extends DependencyInjectionError {
  constructor(token: TServiceToken) {
    const normalizedToken = normalizeToken(token);
    super(`Unknown token type for token '${normalizedToken.toString()}'`);
  }
}

export class UnknownLifetimeError extends DependencyInjectionError {
  constructor(lifetime: ELifetime) {
    super(`Unknown lifetime: ${lifetime}`);
  }
}

export class LifecycleSingletonScopedDependencyViolationError extends DependencyInjectionError {
  constructor(
    public readonly dependentToken: TServiceToken,
    public readonly dependentLifetime: ELifetime,
    public readonly dependencyToken: TServiceToken,
    public readonly dependencyLifetime: ELifetime
  ) {
    const normalizedDependentToken = normalizeToken(dependentToken);
    const normalizedDependencyToken = normalizeToken(dependencyToken);
    super(
      `Lifecycle dependency violation: ${dependentLifetime} service '${normalizedDependentToken.toString()}' cannot depend on ${dependencyLifetime} service '${normalizedDependencyToken.toString()}'. Singletons cannot depend on scoped services.`
    );
  }
}
