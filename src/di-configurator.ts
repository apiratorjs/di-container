import { AsyncContext, AsyncContextStore } from "@apiratorjs/async-context";
import { DiContainer } from "./di-container";
import { IDiConfigurator, IDiModule, IOnConstruct, IOnDispose, ServiceToken } from "./types";
import { tokenToString } from "./utils";
import { Mutex } from "@apiratorjs/locking";
import { CircularDependencyError, RequestScopeResolutionError, UnregisteredDependencyError } from "./errors";

const DI_CONTAINER_REQUEST_SCOPE_NAMESPACE = "APIRATORJS_DI_CONTAINER_REQUEST_SCOPE_NAMESPACE";

export class DiConfigurator implements IDiConfigurator {
  private _singletonServices = new Map<ServiceToken, any>();
  private _singletonServiceFactories = new Map<ServiceToken, (diConfigurator: DiConfigurator) => Promise<any> | any>();
  private _requestScopeServiceFactories = new Map<ServiceToken, (diConfigurator: DiConfigurator) => Promise<any> | any>();
  private _transientFactories = new Map<ServiceToken, (diConfigurator: DiConfigurator) => Promise<any> | any>();
  private _serviceMutexes = new Map<ServiceToken, Mutex>();
  private _resolutionChains = new Map<AsyncContextStore | undefined, Set<ServiceToken>>();
  private _registeredModules = new Set<IDiModule>();

  public addSingleton<T>(
    token: ServiceToken<any>,
    factory: (container: DiConfigurator) => Promise<T> | T
  ) {
    this._singletonServiceFactories.set(token, factory);

    return this;
  }

  public async disposeSingletons() {
    await Promise.all(
      Array.from(this._singletonServices.values()).map(async (service) => {
        if ((service as IOnDispose)?.onDispose) {
          await (service as IOnDispose).onDispose();
        }
      })
    );

    this._singletonServices.clear();
  }

  public addScoped<T>(
    token: ServiceToken<any>,
    factory: (diConfigurator: DiConfigurator) => Promise<T> | T
  ) {
    this._requestScopeServiceFactories.set(token, factory);

    return this;
  }

  public addTransient<T>(
    token: ServiceToken<any>,
    factory: (container: DiConfigurator) => Promise<T> | T
  ) {
    this._transientFactories.set(token, factory);

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

  public async resolve<T>(token: ServiceToken<T>): Promise<T> {
    this.checkForCircularDependency(token);

    const mutex = this.getMutexFor(token);

    return await mutex.runExclusive(async () => {
      try {
        this.addToResolutionChain(token);

        return (
          (await this.tryGetSingleton<T>(token)) ??
          (await this.tryGetScoped<T>(token)) ??
          (await this.tryGetTransient<T>(token)) ??
          (function (): never {
            throw new UnregisteredDependencyError(token);
          })()
        );
      } finally {
        this.removeFromResolutionChain(token);
      }
    });
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

  public build() {
    return new DiContainer(this);
  }

  // ============================
  // Private methods
  // ============================

  /**
   * Lazy initializes and returns a singleton service.
   */
  private async tryGetSingleton<T>(token: ServiceToken): Promise<T | undefined> {
    if (this._singletonServices.has(token)) {
      return this._singletonServices.get(token);
    }

    const factory = this._singletonServiceFactories.get(token);
    if (!factory) {
      return;
    }

    // Check if service was already initialized by another thread
    if (this._singletonServices.has(token)) {
      return this._singletonServices.get(token);
    }

    const service = await factory(this);
    if ((service as IOnConstruct)?.onConstruct) {
      await (service as IOnConstruct).onConstruct();
    }

    this._singletonServices.set(token, service);

    return service;
  }

  private async tryGetScoped<T>(token: ServiceToken): Promise<T | undefined> {
    if (!this._requestScopeServiceFactories.has(token)) {
      return;
    }

    const store = this.getRequestScopeContext();
    if (!store) {
      throw new RequestScopeResolutionError(token);
    }

    if (store.has(token)) {
      return store.get(token);
    }

    // Check if service was already initialized by another thread
    if (store.has(token)) {
      return store.get(token);
    }

    const factory = this._requestScopeServiceFactories.get(token)!;
    const service = await factory(this);
    if ((service as IOnConstruct)?.onConstruct) {
      await (service as IOnConstruct).onConstruct();
    }
    store.set(token, service);

    return service;
  }

  private async tryGetTransient<T>(token: ServiceToken): Promise<T | undefined> {
    if (!this._transientFactories.has(token)) {
      return;
    }

    const factory = this._transientFactories.get(token)!;
    const service = await factory(this);
    if ((service as IOnConstruct)?.onConstruct) {
      await (service as IOnConstruct).onConstruct();
    }

    return service;
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

  private getMutexFor(token: ServiceToken): Mutex {
    if (!this._serviceMutexes.has(token)) {
      this._serviceMutexes.set(token, new Mutex());
    }

    return this._serviceMutexes.get(token)!;
  }

  // ============================
  // Circular dependency detection
  // ============================
  private getCurrentResolutionChain(): Set<ServiceToken> {
    const currentScope = this.getRequestScopeContext();
    if (!this._resolutionChains.has(currentScope)) {
      this._resolutionChains.set(currentScope, new Set<ServiceToken>());
    }
    return this._resolutionChains.get(currentScope)!;
  }

  private addToResolutionChain(token: ServiceToken): void {
    this.getCurrentResolutionChain().add(token);
  }

  private removeFromResolutionChain(token: ServiceToken): void {
    this.getCurrentResolutionChain().delete(token);
  }

  private checkForCircularDependency(token: ServiceToken): void {
    const currentChain = this.getCurrentResolutionChain();

    if (currentChain.has(token)) {
      const chainTokens = Array.from(currentChain);

      const startIndex = chainTokens.findIndex((t) => t === token);

      const cycle = [...chainTokens.slice(startIndex), token].map((t) => tokenToString(t));

      throw new CircularDependencyError(token, cycle);
    }
  }
}
