import { AsyncContext, AsyncContextStore } from "@apiratorjs/async-context";
import { DiContainer } from "./di-container";
import {
  IDiConfigurator,
  IDiModule,
  IOnConstruct,
  IOnDispose,
  TServiceToken,
  TUseFactory,
  ISingletonOptions,
} from "./types";
import { normalizeTagToCompatibleFormat, tokenToString } from "./utils";
import { Mutex } from "@apiratorjs/locking";
import {
  CircularDependencyError,
  RequestScopeResolutionError,
  UnregisteredDependencyError,
} from "./errors";
import { DiDiscoveryService } from "./di-discovery-service";
import {
  ScopedServiceRegistration,
  ServiceRegistration,
} from "./service-registration";

const DI_CONTAINER_REQUEST_SCOPE_NAMESPACE =
  "APIRATORJS_DI_CONTAINER_REQUEST_SCOPE_NAMESPACE";

export class DiConfigurator implements IDiConfigurator {
  private readonly _singletonServiceRegistry = new Map<
    TServiceToken,
    ServiceRegistration[]
  >();
  private readonly _requestScopeServiceRegistry = new Map<
    TServiceToken,
    ServiceRegistration[]
  >();
  private readonly _transientServiceRegistry = new Map<
    TServiceToken,
    ServiceRegistration[]
  >();
  private readonly _serviceMutexes = new Map<TServiceToken, Mutex>();
  private readonly _resolutionChains = new Map<
    AsyncContextStore | undefined,
    Set<TServiceToken>
  >();
  private readonly _registeredModules = new Set<IDiModule>();
  private readonly _discoveryService = new DiDiscoveryService(() =>
    this.listServiceRegistrations()
  );

  public addSingleton<T>(
    token: TServiceToken<any>,
    factory: TUseFactory<T>,
    singletonOptions?: ISingletonOptions,
    tag?: string
  ) {
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

    const serviceRegistration = new ServiceRegistration({
      token,
      factory,
      lifetime: "singleton",
      tag: normalizedTag,
      singletonOptions,
    });

    serviceRegistrationList.push(serviceRegistration);

    this._singletonServiceRegistry.set(token, serviceRegistrationList);

    return this;
  }

  public addScoped<T>(
    token: TServiceToken<any>,
    factory: TUseFactory<T>,
    tag?: string
  ) {
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

    const serviceRegistration = new ScopedServiceRegistration({
      token,
      factory,
      lifetime: "scoped",
      tag: normalizedTag,
      requestScopeContextGetter: () => this.getRequestScopeContext(),
    });

    serviceRegistrationList.push(serviceRegistration);

    this._requestScopeServiceRegistry.set(token, serviceRegistrationList);

    return this;
  }

  public addTransient<T>(
    token: TServiceToken<any>,
    factory: TUseFactory<T>,
    tag?: string
  ) {
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

    const serviceRegistration = new ServiceRegistration({
      token,
      factory,
      lifetime: "transient",
      tag: normalizedTag,
    });

    serviceRegistrationList.push(serviceRegistration);

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

  public async resolve<T>(
    token: TServiceToken<T>,
    tag?: string
  ): Promise<T | undefined> {
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

  public async resolveRequired<T>(token: TServiceToken<T>): Promise<T> {
    const service = await this.resolve<T>(token);
    if (!service) {
      throw new UnregisteredDependencyError(token);
    }

    return service;
  }

  public async resolveAll<T>(token: TServiceToken<T>): Promise<T[]> {
    this.checkForCircularDependency(token);

    const mutex = this.getMutexFor(token);

    return await mutex.runExclusive(async () => {
      try {
        this.addToResolutionChain(token);

        const singletonServices = await this.getSingletonAll<T>(token);
        if (singletonServices.length > 0) {
          return singletonServices;
        }

        const scopedServices = await this.getScopedAll<T>(token);
        if (scopedServices.length > 0) {
          return scopedServices;
        }

        const transientServices = await this.getTransientAll<T>(token);
        if (transientServices.length > 0) {
          return transientServices;
        }

        throw new UnregisteredDependencyError(token);
      } finally {
        this.removeFromResolutionChain(token);
      }
    });
  }

  public async resolveTagged<T>(tag: string): Promise<T | undefined> {
    const normalizedTag = normalizeTagToCompatibleFormat(tag);
    const serviceRegistration = this.listServiceRegistrations().find(
      (serviceRegistration) => serviceRegistration.tag === normalizedTag
    );

    if (!serviceRegistration) {
      return;
    }

    return await this.resolve(
      serviceRegistration.token,
      serviceRegistration.tag
    );
  }

  public async resolveTaggedRequired<T>(tag: string): Promise<T> {
    const service = await this.resolveTagged<T>(tag);
    if (!service) {
      throw new UnregisteredDependencyError(tag);
    }

    return service;
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

  public async dispose(): Promise<void> {
    await Promise.all([this.disposeSingletons(), this.disposeScopedServices()]);
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

  private listServiceRegistrations(): ServiceRegistration[] {
    return [
      ...Array.from(this._singletonServiceRegistry.values()).flat(),
      ...Array.from(this._requestScopeServiceRegistry.values()).flat(),
      ...Array.from(this._transientServiceRegistry.values()).flat(),
    ];
  }

  private async tryGetSingleton<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    const serviceRegistrationList = this._singletonServiceRegistry.get(token);
    if (!serviceRegistrationList?.length) {
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

    if (serviceRegistration.isResolved) {
      return serviceRegistration.getInstance();
    }

    if (!serviceRegistration.factory) {
      return;
    }

    const serviceInstance = await serviceRegistration.factory(this);
    if ((serviceInstance as IOnConstruct)?.onConstruct) {
      await (serviceInstance as IOnConstruct).onConstruct();
    }

    serviceRegistration.setInstance(serviceInstance);

    return serviceInstance;
  }

  private async getSingletonAll<T>(token: TServiceToken): Promise<T[]> {
    const serviceRegistrationList = this._singletonServiceRegistry.get(token);
    if (!serviceRegistrationList?.length) {
      return [];
    }

    const services: T[] = [];

    for (const serviceRegistration of serviceRegistrationList) {
      if (serviceRegistration.isResolved) {
        services.push(serviceRegistration.getInstance());
      } else {
        if (!serviceRegistration.factory) {
          continue;
        }

        const serviceInstance = await serviceRegistration.factory(this);
        if ((serviceInstance as IOnConstruct)?.onConstruct) {
          await (serviceInstance as IOnConstruct).onConstruct();
        }

        serviceRegistration.setInstance(serviceInstance);

        services.push(serviceInstance);
      }
    }

    return services;
  }

  private async tryGetScoped<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    const serviceRegistrationList =
      this._requestScopeServiceRegistry.get(token);
    if (!serviceRegistrationList?.length) {
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

    const store = this.getRequestScopeContext();
    if (!store) {
      throw new RequestScopeResolutionError(token);
    }

    if (serviceRegistration.isResolved) {
      return serviceRegistration.getInstance();
    }

    if (!serviceRegistration.factory) {
      return;
    }

    const serviceInstance = await serviceRegistration.factory(this);
    if ((serviceInstance as IOnConstruct)?.onConstruct) {
      await (serviceInstance as IOnConstruct).onConstruct();
    }

    serviceRegistration.setInstance(serviceInstance);

    return serviceInstance;
  }

  private async getScopedAll<T>(token: TServiceToken): Promise<T[]> {
    const serviceRegistrationList =
      this._requestScopeServiceRegistry.get(token);
    if (!serviceRegistrationList?.length) {
      return [];
    }

    const store = this.getRequestScopeContext();
    if (!store) {
      throw new RequestScopeResolutionError(token);
    }

    const services: T[] = [];

    for (const serviceRegistration of serviceRegistrationList) {
      if (serviceRegistration.isResolved) {
        services.push(serviceRegistration.getInstance());
      } else {
        if (!serviceRegistration.factory) {
          continue;
        }

        const serviceInstance = await serviceRegistration.factory(this);
        if ((serviceInstance as IOnConstruct)?.onConstruct) {
          await (serviceInstance as IOnConstruct).onConstruct();
        }

        serviceRegistration.setInstance(serviceInstance);

        services.push(serviceInstance);
      }
    }

    return services;
  }

  private async tryGetTransient<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    const serviceRegistrationList = this._transientServiceRegistry.get(token);
    if (!serviceRegistrationList?.length) {
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

  private async getTransientAll<T>(token: TServiceToken): Promise<T[]> {
    const serviceRegistrationList = this._transientServiceRegistry.get(token);
    if (!serviceRegistrationList?.length) {
      return [];
    }

    const services: T[] = [];

    for (const serviceRegistration of serviceRegistrationList) {
      const serviceInstance = await serviceRegistration.factory(this);
      if ((serviceInstance as IOnConstruct)?.onConstruct) {
        await (serviceInstance as IOnConstruct).onConstruct();
      }

      services.push(serviceInstance);
    }

    return services;
  }

  public async disposeSingletons() {
    await Promise.all(
      Array.from(this._singletonServiceRegistry.entries()).map(
        async ([token, serviceList]) => {
          const mutex = this.getMutexFor(token);

          await mutex.runExclusive(async () => {
            for (const serviceRegistration of serviceList) {
              if (serviceRegistration.isResolved) {
                const instance = serviceRegistration.getInstance();
                if ("onDispose" in instance) {
                  await (instance as IOnDispose).onDispose();
                }
                serviceRegistration.clearInstance();
              }
            }
          });
        }
      )
    );
  }

  public async disposeScopedServices(): Promise<void> {
    const scope = this.getRequestScopeContext();
    if (!scope) {
      return;
    }

    await Promise.all(
      Array.from(this._requestScopeServiceRegistry.entries()).map(
        async ([token, serviceList]) => {
          const mutex = this.getMutexFor(token);

          await mutex.runExclusive(async () => {
            for (const serviceRegistration of serviceList) {
              if (serviceRegistration.isResolved) {
                const instance = serviceRegistration.getInstance();
                if ("onDispose" in instance) {
                  await (instance as IOnDispose).onDispose();
                }
                serviceRegistration.clearInstance();
              }
            }
          });
        }
      )
    );
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
