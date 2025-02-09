import { AsyncContext, AsyncContextStore } from "@apiratorjs/async-context";
import { DiContainer } from "./di-container";
import { IDiConfigurator, IOnConstruct, IOnDispose, ServiceToken } from "./types";
import { tokenToString } from "./utils";

const DI_CONTAINER_REQUEST_SCOPE_NAMESPACE = "DI_CONTAINER_REQUEST_SCOPE_NAMESPACE";

export class DiConfigurator implements IDiConfigurator {
  private _singletonServices = new Map<ServiceToken, any>();
  private _singletonServiceFactories = new Map<ServiceToken, (diConfigurator: DiConfigurator) => Promise<any> | any>();
  private _requestScopeServiceFactories = new Map<ServiceToken, (diConfigurator: DiConfigurator) => Promise<any> | any>();
  private _transientFactories = new Map<ServiceToken, (diConfigurator: DiConfigurator) => Promise<any> | any>();

  public addSingleton<T>(
    token: ServiceToken<any>,
    factory: (container: DiConfigurator) => Promise<T> | T
  ) {
    if (this._singletonServiceFactories.has(token)) {
      throw new Error(`Singleton service for token ${token.toString()} is already registered`);
    }

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
    if (this._requestScopeServiceFactories.has(token)) {
      throw new Error(`Request scoped service for token ${token.toString()} is already registered`);
    }

    this._requestScopeServiceFactories.set(token, factory);

    return this;
  }

  public addTransient<T>(
    token: ServiceToken<any>,
    factory: (container: DiConfigurator) => Promise<T> | T
  ) {
    if (this._transientFactories.has(token)) {
      throw new Error(`Transient service for token ${token.toString()} is already registered`);
    }

    this._transientFactories.set(token, factory);

    return this;
  }

  public async resolve<T>(token: ServiceToken<T>): Promise<T> {
    return (
      await this.tryGetSingleton<T>(token) ??
      await this.tryGetScoped<T>(token) ??
      (await this.tryGetTransient<T>(token)) ??
      (function (): never {
        throw new Error(`Service for token ${tokenToString(token)} is not registered`);
      })()
    );
  }

  public async runWithNewRequestScope(
    initialStore: AsyncContextStore,
    callback: () => Promise<any> | any
  ) {
    return await AsyncContext.withContext(DI_CONTAINER_REQUEST_SCOPE_NAMESPACE, initialStore ?? new AsyncContextStore(), async () => {
      try {
        return await callback();
      } finally {
        await this.disposeScopedServices();
      }
    });
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

    // TODO: Use mutex to prevent multiple calls to the same factory. Once mutex released, check if service is already initialized again.

    const factory = this._singletonServiceFactories.get(token);
    if (!factory) {
      return;
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
      throw new Error(
        `Cannot resolve request-scoped service '${tokenToString(token)}' outside of a request scope. It is likely that a singleton or transient service is trying to inject a request-scoped dependency.`
      );
    }

    if (store.has(token)) {
      return store.get(token);
    }

    // TODO: Use mutex to prevent multiple calls to the same factory. Once mutex released, check if service is already initialized again.

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
}
