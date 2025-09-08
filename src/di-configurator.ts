import { AsyncContext, AsyncContextStore } from "@apiratorjs/async-context";
import { DiContainer } from "./di-container";
import {
  IDiConfigurator,
  IDiModule,
  IOnConstruct,
  IOnDispose,
  TServiceToken,
  TUseFactory,
  IServiceRegistration,
  ISingletonOptions,
  TClassType,
} from "./types";
import {
  normalizeTagToCompatibleFormat,
  tokenToString,
  tokenToType,
} from "./utils";
import { Mutex } from "@apiratorjs/locking";
import {
  CircularDependencyError,
  RequestScopeResolutionError,
  UnregisteredDependencyError,
} from "./errors";
import { DiDiscoveryService } from "./di-discovery-service";

const DI_CONTAINER_REQUEST_SCOPE_NAMESPACE =
  "APIRATORJS_DI_CONTAINER_REQUEST_SCOPE_NAMESPACE";

export class DiConfigurator implements IDiConfigurator {
  private readonly _singletonServiceRegistry = new Map<
    TServiceToken,
    IServiceRegistration[]
  >();
  private readonly _requestScopeServiceRegistry = new Map<
    TServiceToken,
    IServiceRegistration[]
  >();
  private readonly _transientServiceRegistry = new Map<
    TServiceToken,
    IServiceRegistration[]
  >();
  private readonly _serviceMutexes = new Map<TServiceToken, Mutex>();
  private readonly _resolutionChains = new Map<
    AsyncContextStore | undefined,
    Set<TServiceToken>
  >();
  private readonly _registeredModules = new Set<IDiModule>();
  private readonly _discoveryService = new DiDiscoveryService(() => [
    ...Array.from(this._singletonServiceRegistry.values()).flat(),
    ...Array.from(this._requestScopeServiceRegistry.values()).flat(),
    ...Array.from(this._transientServiceRegistry.values()).flat(),
  ]);

  public addSingleton<T>(
    token: TServiceToken<any>,
    factory: TUseFactory<T>,
    singletonOptions?: ISingletonOptions,
    tag?: string
  ) {
    const tokenType = tokenToType(token);
    const normalizedTag = normalizeTagToCompatibleFormat(tag ?? "default");

    const serviceRegistrationList =
      this._singletonServiceRegistry.get(token) ?? [];

    const hasServiceRegistration = serviceRegistrationList.some(
      (serviceRegistration) => {
        return (
          normalizeTagToCompatibleFormat(serviceRegistration.tag) ===
          normalizeTagToCompatibleFormat(normalizedTag)
        );
      }
    );

    if (hasServiceRegistration) {
      return this;
    }

    serviceRegistrationList.push({
      token,
      tokenType,
      lifetime: "singleton",
      factory,
      singletonOptions,
      tag: normalizedTag,
      isResolved: false,
      instance: undefined,
      metatype: tokenType === "class" ? (token as TClassType<T>) : undefined,
    });

    this._singletonServiceRegistry.set(token, serviceRegistrationList);

    return this;
  }

  public async disposeSingletons() {
    await Promise.all(
      Array.from(this._singletonServiceRegistry.values()).map(
        async (serviceList) => {
          for (const service of serviceList) {
            if (
              service.instance &&
              (service.instance as IOnDispose)?.onDispose
            ) {
              await (service.instance as IOnDispose).onDispose();
            }
          }
        }
      )
    );

    this._singletonServiceRegistry.clear();
  }

  public addScoped<T>(
    token: TServiceToken<any>,
    factory: TUseFactory<T>,
    tag?: string
  ) {
    const tokenType = tokenToType(token);
    const normalizedTag = normalizeTagToCompatibleFormat(tag ?? "default");

    const serviceRegistrationList =
      this._requestScopeServiceRegistry.get(token) ?? [];

    const hasServiceRegistration = serviceRegistrationList.some(
      (serviceRegistration) => {
        return (
          normalizeTagToCompatibleFormat(serviceRegistration.tag) ===
          normalizeTagToCompatibleFormat(normalizedTag)
        );
      }
    );

    if (hasServiceRegistration) {
      return this;
    }

    serviceRegistrationList.push({
      token,
      tokenType,
      lifetime: "scoped",
      factory,
      tag: normalizedTag,
      isResolved: false,
      instance: undefined,
      metatype: tokenType === "class" ? (token as TClassType<T>) : undefined,
    });

    this._requestScopeServiceRegistry.set(token, serviceRegistrationList);

    return this;
  }

  public addTransient<T>(
    token: TServiceToken<any>,
    factory: TUseFactory<T>,
    tag?: string
  ) {
    const tokenType = tokenToType(token);
    const normalizedTag = normalizeTagToCompatibleFormat(tag ?? "default");

    const serviceRegistrationList =
      this._transientServiceRegistry.get(token) ?? [];

    const hasServiceRegistration = serviceRegistrationList.some(
      (serviceRegistration) => {
        return (
          normalizeTagToCompatibleFormat(serviceRegistration.tag) ===
          normalizeTagToCompatibleFormat(normalizedTag)
        );
      }
    );

    if (hasServiceRegistration) {
      return this;
    }

    serviceRegistrationList.push({
      token,
      tokenType,
      lifetime: "transient",
      factory,
      tag: normalizedTag,
      isResolved: false,
      instance: undefined,
      metatype: tokenType === "class" ? (token as TClassType<T>) : undefined,
    });

    this._transientServiceRegistry.set(token, serviceRegistrationList);

    return this;
  }

  public addModule(module: IDiModule) {
    if (this._registeredModules.has(module)) {
      return this;
    }

    this._registeredModules.add(module);

    module.register(this);

    return this;
  }

  public async resolve<T>(token: TServiceToken<T>, tag?: string): Promise<T> {
    this.checkForCircularDependency(token);

    const mutex = this.getMutexFor(token);

    return await mutex.runExclusive(async () => {
      try {
        this.addToResolutionChain(token);

        return (
          (await this.tryGetSingleton<T>(token, tag)) ??
          (await this.tryGetScoped<T>(token, tag)) ??
          (await this.tryGetTransient<T>(token, tag)) ??
          (function (): never {
            throw new UnregisteredDependencyError(token);
          })()
        );
      } finally {
        this.removeFromResolutionChain(token);
      }
    });
  }

  public async resolveAll<T>(
    token: TServiceToken<T>,
    tag?: string
  ): Promise<T[]> {
    throw new Error("Method not implemented.");
  }

  public async resolveTagged<T>(tag: string): Promise<T> {
    throw new Error("Method not implemented.");
  }

  public async resolveAllTagged<T>(tag: string): Promise<T[]> {
    throw new Error("Method not implemented.");
  }

  public async runWithNewRequestScope(
    initialStore: AsyncContextStore,
    callback: () => Promise<any> | any
  ) {
    return await AsyncContext.withContext(
      DI_CONTAINER_REQUEST_SCOPE_NAMESPACE,
      initialStore ?? new AsyncContextStore(),
      async () => {
        try {
          return await callback();
        } finally {
          await this.disposeScopedServices();
        }
      }
    );
  }

  public getRequestScopeContext(): AsyncContextStore | undefined {
    return AsyncContext.getContext(DI_CONTAINER_REQUEST_SCOPE_NAMESPACE);
  }

  public isInRequestScopeContext(): boolean {
    return !!this.getRequestScopeContext();
  }

  public async build() {
    for (const [
      token,
      serviceRegistrationList,
    ] of this._singletonServiceRegistry.entries()) {
      for (const serviceRegistration of serviceRegistrationList) {
        if (serviceRegistration.singletonOptions?.eager) {
          await this.tryGetSingleton(token, serviceRegistration.tag);
        }
      }
    }

    return new DiContainer(this);
  }

  public getDiscoveryService(): DiDiscoveryService {
    return this._discoveryService;
  }

  // ============================
  // Private methods
  // ============================

  /**
   * Lazy initializes and returns a singleton service.
   */
  private async tryGetSingleton<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    const serviceRegistrationList = this._singletonServiceRegistry.get(token);
    if (!serviceRegistrationList) {
      return;
    }

    const serviceRegistration = serviceRegistrationList.find(
      (serviceRegistration) => {
        return (
          normalizeTagToCompatibleFormat(serviceRegistration.tag) ===
          normalizeTagToCompatibleFormat(tag ?? "default")
        );
      }
    );

    if (!serviceRegistration) {
      return;
    }

    if (serviceRegistration.isResolved && serviceRegistration.instance) {
      return serviceRegistration.instance;
    }

    if (!serviceRegistration.factory) {
      return;
    }

    const serviceInstance = await serviceRegistration.factory(this);
    if ((serviceInstance as IOnConstruct)?.onConstruct) {
      await (serviceInstance as IOnConstruct).onConstruct();
    }

    serviceRegistration.isResolved = true;
    serviceRegistration.instance = serviceInstance;

    return serviceInstance;
  }

  private async tryGetScoped<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    const serviceRegistrationList =
      this._requestScopeServiceRegistry.get(token);
    if (!serviceRegistrationList) {
      return;
    }

    const normalizedTag = normalizeTagToCompatibleFormat(tag ?? "default");

    const serviceRegistration = serviceRegistrationList.find(
      (serviceRegistration) => {
        return (
          normalizeTagToCompatibleFormat(serviceRegistration.tag) ===
          normalizedTag
        );
      }
    );

    const store = this.getRequestScopeContext();
    if (!store) {
      throw new RequestScopeResolutionError(token);
    }

    if (!serviceRegistration) {
      return;
    }

    // Check if service already exists in the current scope's store
    const storeKey = `${token.toString()}:${normalizedTag}`;
    const existingService = store.get(storeKey);

    if (existingService) {
      return existingService;
    }

    if (!serviceRegistration.factory) {
      return;
    }

    const serviceInstance = await serviceRegistration.factory(this);
    if ((serviceInstance as IOnConstruct)?.onConstruct) {
      await (serviceInstance as IOnConstruct).onConstruct();
    }

    store.set(storeKey, serviceInstance);

    serviceRegistration.isResolved = true;
    serviceRegistration.instance = serviceInstance;

    return serviceInstance;
  }

  private async tryGetTransient<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    const serviceRegistrationList = this._transientServiceRegistry.get(token);
    if (!serviceRegistrationList) {
      return;
    }

    const normalizedTag = normalizeTagToCompatibleFormat(tag ?? "default");

    const serviceRegistration = serviceRegistrationList.find(
      (serviceRegistration) => {
        return (
          normalizeTagToCompatibleFormat(serviceRegistration.tag) ===
          normalizedTag
        );
      }
    );

    if (!serviceRegistration) {
      return;
    }

    const serviceInstance = await serviceRegistration.factory(this);
    if ((serviceInstance as IOnConstruct)?.onConstruct) {
      await (serviceInstance as IOnConstruct).onConstruct();
    }

    return serviceInstance;
  }

  private async disposeScopedServices(): Promise<void> {
    const scope = this.getRequestScopeContext();
    if (!scope) {
      return;
    }

    for (const service of scope.values()) {
      if ((service as IOnDispose)?.onDispose) {
        await (service as IOnDispose).onDispose();
      }
    }
  }

  private getMutexFor(token: TServiceToken): Mutex {
    if (!this._serviceMutexes.has(token)) {
      this._serviceMutexes.set(token, new Mutex());
    }

    return this._serviceMutexes.get(token)!;
  }

  // ============================
  // Circular dependency detection
  // ============================
  private getCurrentResolutionChain(): Set<TServiceToken> {
    const currentScope = this.getRequestScopeContext();
    if (!this._resolutionChains.has(currentScope)) {
      this._resolutionChains.set(currentScope, new Set<TServiceToken>());
    }
    return this._resolutionChains.get(currentScope)!;
  }

  private addToResolutionChain(token: TServiceToken): void {
    this.getCurrentResolutionChain().add(token);
  }

  private removeFromResolutionChain(token: TServiceToken): void {
    this.getCurrentResolutionChain().delete(token);
  }

  private checkForCircularDependency(token: TServiceToken): void {
    const currentChain = this.getCurrentResolutionChain();

    if (currentChain.has(token)) {
      const chainTokens = Array.from(currentChain);

      const startIndex = chainTokens.findIndex((t) => t === token);

      const cycle = [...chainTokens.slice(startIndex), token].map((t) =>
        tokenToString(t)
      );

      throw new CircularDependencyError(token, cycle);
    }
  }
}
