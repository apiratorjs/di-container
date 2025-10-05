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
  constructor(token: TServiceToken, public readonly chain: string[], public readonly tag?: string) {
    const normalizedToken = normalizeToken(token);
    const tokenDescription = tag ? `${normalizedToken.toString()} (tag: '${tag}')` : normalizedToken.toString();
    super(
      `Circular dependency detected for token ${tokenDescription}`,
      chain.join(" -> ")
    );
  }
}

export class UnregisteredDependencyError extends DependencyInjectionError {
  constructor(token: TServiceToken, public readonly tag?: string, public readonly cause?: string) {
    const normalizedToken = normalizeToken(token);
    const tokenDescription = tag ? `${normalizedToken.toString()} (tag: '${tag}')` : normalizedToken.toString();
    super(
      `Service for token ${tokenDescription} is not registered`,
      cause
    );
  }
}

export class RequestScopeResolutionError extends DependencyInjectionError {
  constructor(token: TServiceToken, public readonly tag?: string, public readonly cause?: string) {
    const normalizedToken = normalizeToken(token);
    const tokenDescription = tag ? `'${normalizedToken.toString()}' (tag: '${tag}')` : `'${normalizedToken.toString()}'`;
    super(
      `Cannot resolve request-scoped service for token ${tokenDescription} outside of a request scope. It is likely that a singleton or transient service is trying to inject a request-scoped dependency.`,
      cause
    );
  }
}

export class CrossLifecycleRegistrationError extends DependencyInjectionError {
  constructor(
    token: TServiceToken,
    public readonly existingLifecycle: string,
    public readonly attemptedLifecycle: string,
    public readonly tag?: string,
    public readonly cause?: string
  ) {
    const normalizedToken = normalizeToken(token);
    const tokenDescription = tag ? `'${normalizedToken.toString()}' (tag: '${tag}')` : `'${normalizedToken.toString()}'`;
    super(
      `Cannot register token ${tokenDescription} as ${attemptedLifecycle} because it is already registered as ${existingLifecycle}. Cross-lifecycle registration is not allowed.`,
      cause
    );
  }
}

export class UnregisteredTagError extends DependencyInjectionError {
  constructor(public readonly tag: string) {
    super(`No service is registered with tag '${tag}'`);
  }
}

export class UnknownTokenTypeError extends DependencyInjectionError {
  constructor(token: TServiceToken, public readonly tag?: string) {
    const normalizedToken = normalizeToken(token);
    const tokenDescription = tag ? `'${normalizedToken.toString()}' (tag: '${tag}')` : `'${normalizedToken.toString()}'`;
    super(`Unknown token type for token ${tokenDescription}`);
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
    public readonly dependencyLifetime: ELifetime,
    public readonly dependentTag?: string,
    public readonly dependencyTag?: string
  ) {
    const normalizedDependentToken = normalizeToken(dependentToken);
    const normalizedDependencyToken = normalizeToken(dependencyToken);
    const dependentDescription = dependentTag ? `'${normalizedDependentToken.toString()}' (tag: '${dependentTag}')` : `'${normalizedDependentToken.toString()}'`;
    const dependencyDescription = dependencyTag ? `'${normalizedDependencyToken.toString()}' (tag: '${dependencyTag}')` : `'${normalizedDependencyToken.toString()}'`;
    super(
      `Lifecycle dependency violation: ${dependentLifetime} service ${dependentDescription} cannot depend on ${dependencyLifetime} service ${dependencyDescription}. Singletons cannot depend on scoped services.`
    );
  }
}
