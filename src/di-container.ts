import { AsyncContext, AsyncContextStore } from "@apiratorjs/async-context";
import {
  IDiContainer,
  IInitableDiContainer,
  IOnConstruct,
  IOnDispose,
  IResolveAllResult,
  TServiceToken,
} from "./types";
import { DiDiscoveryService } from "./di-discovery-service";
import {
  DI_CONTAINER_REQUEST_SCOPE_NAMESPACE,
  DiConfigurator,
} from "./di-configurator";
import { Mutex } from "@apiratorjs/locking";
import {
  CircularDependencyError,
  RequestScopeResolutionError,
  UnregisteredDependencyError,
} from "./errors";
import { normalizeTagToCompatibleFormat, tokenToString } from "./utils";

export class DiContainer implements IInitableDiContainer {
  private _isInitialized = false;
  private readonly _serviceMutexes = new Map<TServiceToken, Mutex>();
  private readonly _resolutionChains = new Map<
    AsyncContextStore | undefined,
    Set<TServiceToken>
  >();

  public constructor(private readonly _diConfigurator: DiConfigurator) {}

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

  public async resolveRequired<T>(
    token: TServiceToken<T>,
    tag?: string
  ): Promise<T> {
    const service = await this.resolve<T>(token, tag);
    if (!service) {
      throw new UnregisteredDependencyError(token);
    }

    return service;
  }

  public async resolveAll<T>(
    token: TServiceToken<T>
  ): Promise<IResolveAllResult<T>[]> {
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
    const serviceRegistration = this._diConfigurator
      .getDiscoveryService()
      .getAll()
      .find((serviceRegistration) => serviceRegistration.tag === normalizedTag);

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
    const normalizedTag = normalizeTagToCompatibleFormat(tag);
    const serviceRegistrationList = this._diConfigurator
      .getDiscoveryService()
      .getAll()
      .filter(
        (serviceRegistration) => serviceRegistration.tag === normalizedTag
      );

    if (!serviceRegistrationList.length) {
      return [];
    }

    const results = await Promise.all(
      serviceRegistrationList.map((serviceRegistration) =>
        this.resolve(serviceRegistration.token, serviceRegistration.tag)
      )
    );

    return results.filter((result): result is T => result !== undefined);
  }

  public async runWithNewRequestScope(
    callback: (diContainer: IDiContainer) => Promise<any> | any,
    initialStore: AsyncContextStore
  ) {
    return await AsyncContext.withContext(
      DI_CONTAINER_REQUEST_SCOPE_NAMESPACE,
      initialStore ?? new AsyncContextStore(),
      async () => {
        try {
          return await callback(this);
        } finally {
          await this.disposeScopedServices();
        }
      }
    );
  }

  public getDiscoveryService(): DiDiscoveryService {
    return this._diConfigurator.getDiscoveryService();
  }

  private getRequestScopeContext(): AsyncContextStore | undefined {
    return this._diConfigurator.getRequestScopeContext();
  }

  public isInRequestScopeContext(): boolean {
    return !!this.getRequestScopeContext();
  }

  public async dispose(): Promise<void> {
    await Promise.all([this.disposeSingletons(), this.disposeScopedServices()]);
  }

  public async disposeSingletons() {
    await Promise.all(
      Array.from(this._diConfigurator.singletonServiceRegistry.entries()).map(
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
      Array.from(
        this._diConfigurator.requestScopeServiceRegistry.entries()
      ).map(async ([token, serviceList]) => {
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
      })
    );
  }

  public async init(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    for (const [
      token,
      serviceRegistrationList,
    ] of this._diConfigurator.singletonServiceRegistry.entries()) {
      for (const serviceRegistration of serviceRegistrationList) {
        if (serviceRegistration.singletonOptions?.eager) {
          await this.tryGetSingleton(token, serviceRegistration.tag);
        }
      }
    }

    this._isInitialized = true;
  }

  private getMutexFor(token: TServiceToken): Mutex {
    if (!this._serviceMutexes.has(token)) {
      this._serviceMutexes.set(token, new Mutex());
    }

    return this._serviceMutexes.get(token)!;
  }

  private async tryGetSingleton<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    const serviceRegistrationList =
      this._diConfigurator.singletonServiceRegistry.get(token);
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

  private async getSingletonAll<T>(
    token: TServiceToken
  ): Promise<IResolveAllResult<T>[]> {
    const serviceRegistrationList =
      this._diConfigurator.singletonServiceRegistry.get(token);
    if (!serviceRegistrationList?.length) {
      return [];
    }

    const services: IResolveAllResult<T>[] = [];

    for (const serviceRegistration of serviceRegistrationList) {
      if (serviceRegistration.isResolved) {
        services.push({
          registration: serviceRegistration,
          instance: serviceRegistration.getInstance(),
        });
      } else {
        if (!serviceRegistration.factory) {
          continue;
        }

        const serviceInstance = await serviceRegistration.factory(this);
        if ((serviceInstance as IOnConstruct)?.onConstruct) {
          await (serviceInstance as IOnConstruct).onConstruct();
        }

        serviceRegistration.setInstance(serviceInstance);

        services.push({
          registration: serviceRegistration,
          instance: serviceInstance,
        });
      }
    }

    return services;
  }

  private async tryGetScoped<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    const serviceRegistrationList =
      this._diConfigurator.requestScopeServiceRegistry.get(token);
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

  private async getScopedAll<T>(
    token: TServiceToken
  ): Promise<IResolveAllResult<T>[]> {
    const serviceRegistrationList =
      this._diConfigurator.requestScopeServiceRegistry.get(token);
    if (!serviceRegistrationList?.length) {
      return [];
    }

    const store = this.getRequestScopeContext();
    if (!store) {
      throw new RequestScopeResolutionError(token);
    }

    const services: IResolveAllResult<T>[] = [];

    for (const serviceRegistration of serviceRegistrationList) {
      if (serviceRegistration.isResolved) {
        services.push({
          registration: serviceRegistration,
          instance: serviceRegistration.getInstance(),
        });
      } else {
        if (!serviceRegistration.factory) {
          continue;
        }

        const serviceInstance = await serviceRegistration.factory(this);
        if ((serviceInstance as IOnConstruct)?.onConstruct) {
          await (serviceInstance as IOnConstruct).onConstruct();
        }

        serviceRegistration.setInstance(serviceInstance);

        services.push({
          registration: serviceRegistration,
          instance: serviceInstance,
        });
      }
    }

    return services;
  }

  private async tryGetTransient<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    const serviceRegistrationList =
      this._diConfigurator.transientServiceRegistry.get(token);
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

  private async getTransientAll<T>(
    token: TServiceToken
  ): Promise<IResolveAllResult<T>[]> {
    const serviceRegistrationList =
      this._diConfigurator.transientServiceRegistry.get(token);
    if (!serviceRegistrationList?.length) {
      return [];
    }

    const services: IResolveAllResult<T>[] = [];

    for (const serviceRegistration of serviceRegistrationList) {
      const serviceInstance = await serviceRegistration.factory(this);
      if ((serviceInstance as IOnConstruct)?.onConstruct) {
        await (serviceInstance as IOnConstruct).onConstruct();
      }

      services.push({
        registration: serviceRegistration,
        instance: serviceInstance,
      });
    }

    return services;
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
