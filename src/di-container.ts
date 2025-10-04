import { AsyncContext, AsyncContextStore } from "@apiratorjs/async-context";
import {
  ELifetime,
  IDiContainer,
  IInitableDiContainer,
  IOnConstruct,
  IOnDispose,
  IResolutionChainLink,
  IResolveAllResult,
  IServiceRegistration,
  TServiceToken,
} from "./types";
import { DiDiscoveryService } from "./di-discovery-service";
import { DiConfigurator } from "./di-configurator";
import { Mutex } from "@apiratorjs/locking";
import {
  RequestScopeResolutionError,
  UnregisteredDependencyError,
} from "./errors";
import { normalizeTagToCompatibleFormat, tokenToString } from "./utils";
import { ServiceRegistration } from "./service-registration";
import { ResolutionChain } from "./resolution-chain";
import {
  DEFAULT_TAG,
  DI_CONTAINER_REQUEST_SCOPE_NAMESPACE,
  DI_CONTAINER_RESOLUTION_CHAIN_NAMESPACE,
} from "./constants";

export class DiContainer implements IInitableDiContainer {
  private _isInitialized = false;
  private readonly _serviceMutexes: Map<string, Mutex> = new Map();

  public constructor(private readonly _diConfigurator: DiConfigurator) {}

  public async resolve<T>(
    token: TServiceToken<T>,
    tag?: string
  ): Promise<T | undefined> {
    if (this.getCurrentResolutionChain()) {
      return await this.runResolution<T>(token, tag);
    }

    return await AsyncContext.withContext(
      DI_CONTAINER_RESOLUTION_CHAIN_NAMESPACE,
      new ResolutionChain(),
      async () => {
        return await this.runResolution<T>(token, tag);
      }
    );
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
    if (this.getCurrentResolutionChain()) {
      return this.runResolutionAll<T>(token);
    }

    return await AsyncContext.withContext(
      DI_CONTAINER_RESOLUTION_CHAIN_NAMESPACE,
      new ResolutionChain(),
      async () => {
        return this.runResolutionAll<T>(token);
      }
    );
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

  public async resolveAllTagged(tag: string): Promise<IResolveAllResult[]> {
    return this.runResolutionAllTagged(tag, false);
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
    const disposalPromises: Promise<void>[] = [];

    for (const [
      token,
      serviceRegistrations,
    ] of this._diConfigurator.singletonServiceRegistry.entries()) {
      for (const serviceRegistration of serviceRegistrations) {
        const normalizedTag = normalizeTagToCompatibleFormat(
          serviceRegistration.tag
        );
        const mutexToken = this.createMutexTokenOf(token, normalizedTag);
        const mutex = this.getMutexFor(mutexToken);

        const disposalPromise = mutex.runExclusive(async () => {
          if (serviceRegistration.isResolved) {
            const instance = serviceRegistration.getInstance();
            if ("onDispose" in instance) {
              await (instance as IOnDispose).onDispose();
            }
            serviceRegistration.clearInstance();
          }
        });

        disposalPromises.push(disposalPromise);
      }
    }

    await Promise.all(disposalPromises);
  }

  public async disposeScopedServices(): Promise<void> {
    if (!this.isInRequestScopeContext()) {
      return;
    }

    const disposalPromises: Promise<void>[] = [];

    for (const [
      token,
      serviceRegistrations,
    ] of this._diConfigurator.requestScopeServiceRegistry.entries()) {
      for (const serviceRegistration of serviceRegistrations) {
        const normalizedTag = normalizeTagToCompatibleFormat(
          serviceRegistration.tag
        );
        const mutexToken = this.createMutexTokenOf(token, normalizedTag);
        const mutex = this.getMutexFor(mutexToken);

        const disposalPromise = mutex.runExclusive(async () => {
          if (serviceRegistration.isResolved) {
            const instance = serviceRegistration.getInstance();
            if ("onDispose" in instance) {
              await (instance as IOnDispose).onDispose();
            }
            serviceRegistration.clearInstance();
          }
        });

        disposalPromises.push(disposalPromise);
      }
    }

    await Promise.all(disposalPromises);
  }

  public resolveAllRequired<T>(
    token: TServiceToken<T>
  ): Promise<IResolveAllResult<T>[]> {
    return this.runResolutionAll<T>(token, true);
  }

  public resolveAllTaggedRequired(tag: string): Promise<IResolveAllResult[]> {
    return this.runResolutionAllTagged(tag, true);
  }

  public async init(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    // Create a resolution context for initialization
    await AsyncContext.withContext(
      DI_CONTAINER_RESOLUTION_CHAIN_NAMESPACE,
      new ResolutionChain(),
      async () => {
        for (const [
          token,
          serviceRegistrations,
        ] of this._diConfigurator.singletonServiceRegistry.entries()) {
          for (const serviceRegistration of serviceRegistrations) {
            if (serviceRegistration.singletonOptions?.eager) {
              await this.tryGetSingleton(token, serviceRegistration.tag);
            }
          }
        }
      }
    );

    this._isInitialized = true;
  }

  private async runResolution<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    return (
      (await this.tryGetSingleton<T>(token, tag)) ??
      (await this.tryGetScoped<T>(token, tag)) ??
      (await this.tryGetTransient<T>(token, tag)) ??
      (function (): never {
        throw new UnregisteredDependencyError(token);
      })()
    );
  }

  private async runResolutionAll<T>(
    token: TServiceToken,
    throwErrorIfNoServices: boolean = false
  ): Promise<IResolveAllResult<T>[]> {
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

    if (throwErrorIfNoServices) {
      throw new UnregisteredDependencyError(token);
    }

    return [];
  }

  private async runResolutionAllTagged<T>(
    tag: string,
    throwErrorIfNoServices: boolean = false
  ): Promise<IResolveAllResult[]> {
    const normalizedTag = normalizeTagToCompatibleFormat(tag);
    const serviceRegistrationList = this._diConfigurator
      .getDiscoveryService()
      .getAll()
      .filter(
        (serviceRegistration) => serviceRegistration.tag === normalizedTag
      );

    if (!serviceRegistrationList.length) {
      if (throwErrorIfNoServices) {
        throw new UnregisteredDependencyError(tag);
      }

      return [];
    }

    const results = await Promise.all(
      serviceRegistrationList.map((serviceRegistration) =>
        this.resolve(serviceRegistration.token, serviceRegistration.tag)
      )
    );

    return results.filter(
      (result): result is IResolveAllResult => result !== undefined
    );
  }

  private getMutexFor(token: string): Mutex {
    if (!this._serviceMutexes.has(token)) {
      this._serviceMutexes.set(token, new Mutex());
    }

    return this._serviceMutexes.get(token)!;
  }

  private async tryGetSingleton<T>(
    token: TServiceToken,
    tag?: string
  ): Promise<T | undefined> {
    const serviceRegistration = this.findServiceRegistration(
      ELifetime.Singleton,
      token,
      tag
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

    const chainLink: IResolutionChainLink = {
      token,
      lifetime: ELifetime.Singleton,
      tag: normalizeTagToCompatibleFormat(tag),
    };

    this.getCurrentResolution().checkForDependencyViolation(chainLink);

    const mutexToken = this.createMutexTokenOf(token, tag);
    const mutex = this.getMutexFor(mutexToken);

    return await mutex.runExclusive(async () => {
      try {
        this.addToResolutionChainFor(chainLink);

        // Double check if the service is resolved in a concurrent thread
        if (serviceRegistration.isResolved) {
          return serviceRegistration.getInstance();
        }

        const serviceInstance = await serviceRegistration.factory(this);
        if ((serviceInstance as IOnConstruct)?.onConstruct) {
          await (serviceInstance as IOnConstruct).onConstruct();
        }

        (serviceRegistration as ServiceRegistration<T>).setInstance(
          serviceInstance
        );

        return serviceInstance;
      } finally {
        this.removeFromResolutionChainFor(chainLink);
      }
    });
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

        const chainLink: IResolutionChainLink = {
          token,
          lifetime: ELifetime.Singleton,
          tag: normalizeTagToCompatibleFormat(serviceRegistration.tag),
        };

        this.getCurrentResolution().checkForDependencyViolation(chainLink);

        const mutexToken = this.createMutexTokenOf(
          token,
          serviceRegistration.tag
        );
        const mutex = this.getMutexFor(mutexToken);

        const serviceInstance = await mutex.runExclusive(async () => {
          try {
            this.addToResolutionChainFor(chainLink);

            // Double check if the service is resolved in a concurrent thread
            if (serviceRegistration.isResolved) {
              return serviceRegistration.getInstance();
            }

            const instance = await serviceRegistration.factory(this);
            if ((instance as IOnConstruct)?.onConstruct) {
              await (instance as IOnConstruct).onConstruct();
            }

            serviceRegistration.setInstance(instance);
            return instance;
          } finally {
            this.removeFromResolutionChainFor(chainLink);
          }
        });

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
    const serviceRegistration = this.findServiceRegistration(
      ELifetime.Scoped,
      token,
      tag
    );
    if (!serviceRegistration) {
      return;
    }

    // Check scope context after finding the service registration to prevent unexpected calling
    // when trying to resolve another service from a different lifecycle
    if (!this.isInRequestScopeContext()) {
      throw new RequestScopeResolutionError(token);
    }

    if (serviceRegistration.isResolved) {
      return serviceRegistration.getInstance();
    }

    if (!serviceRegistration.factory) {
      return;
    }

    const chainLink: IResolutionChainLink = {
      token,
      lifetime: ELifetime.Scoped,
      tag: normalizeTagToCompatibleFormat(tag),
    };

    this.getCurrentResolution().checkForDependencyViolation(chainLink);

    const mutexToken = this.createMutexTokenOf(token, tag);
    const mutex = this.getMutexFor(mutexToken);

    return await mutex.runExclusive(async () => {
      try {
        this.addToResolutionChainFor(chainLink);

        // Double check if the service is resolved in a concurrent thread
        if (serviceRegistration.isResolved) {
          return serviceRegistration.getInstance();
        }

        const serviceInstance = await serviceRegistration.factory(this);
        if ((serviceInstance as IOnConstruct)?.onConstruct) {
          await (serviceInstance as IOnConstruct).onConstruct();
        }

        (serviceRegistration as ServiceRegistration<T>).setInstance(
          serviceInstance
        );

        return serviceInstance;
      } finally {
        this.removeFromResolutionChainFor(chainLink);
      }
    });
  }

  private async getScopedAll<T>(
    token: TServiceToken
  ): Promise<IResolveAllResult<T>[]> {
    const serviceRegistrationList =
      this._diConfigurator.requestScopeServiceRegistry.get(token);
    if (!serviceRegistrationList?.length) {
      return [];
    }

    // Check scope context after finding the service registration list to prevent unexpected calling
    // when trying to resolve another service from a different lifecycle
    if (!this.isInRequestScopeContext()) {
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

        const chainLink: IResolutionChainLink = {
          token,
          lifetime: ELifetime.Scoped,
          tag: normalizeTagToCompatibleFormat(serviceRegistration.tag),
        };

        this.getCurrentResolution().checkForDependencyViolation(chainLink);

        const mutexToken = this.createMutexTokenOf(
          token,
          serviceRegistration.tag
        );
        const mutex = this.getMutexFor(mutexToken);

        const serviceInstance = await mutex.runExclusive(async () => {
          try {
            this.addToResolutionChainFor(chainLink);

            // Double check if the service is resolved in a concurrent thread
            if (serviceRegistration.isResolved) {
              return serviceRegistration.getInstance();
            }

            const instance = await serviceRegistration.factory(this);
            if ((instance as IOnConstruct)?.onConstruct) {
              await (instance as IOnConstruct).onConstruct();
            }

            serviceRegistration.setInstance(instance);
            return instance;
          } finally {
            this.removeFromResolutionChainFor(chainLink);
          }
        });

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
    const serviceRegistration = this.findServiceRegistration(
      ELifetime.Transient,
      token,
      tag
    );
    if (!serviceRegistration) {
      return;
    }

    const chainLink: IResolutionChainLink = {
      token,
      lifetime: ELifetime.Transient,
      tag: normalizeTagToCompatibleFormat(tag),
    };

    this.addToResolutionChainFor(chainLink);

    try {
      const serviceInstance = await serviceRegistration.factory(this);
      if ((serviceInstance as IOnConstruct)?.onConstruct) {
        await (serviceInstance as IOnConstruct).onConstruct();
      }

      return serviceInstance;
    } finally {
      this.removeFromResolutionChainFor(chainLink);
    }
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
      const chainLink: IResolutionChainLink = {
        token,
        lifetime: ELifetime.Transient,
        tag: normalizeTagToCompatibleFormat(serviceRegistration.tag),
      };

      this.addToResolutionChainFor(chainLink);

      try {
        const serviceInstance = await serviceRegistration.factory(this);
        if ((serviceInstance as IOnConstruct)?.onConstruct) {
          await (serviceInstance as IOnConstruct).onConstruct();
        }

        services.push({
          registration: serviceRegistration,
          instance: serviceInstance,
        });
      } finally {
        this.removeFromResolutionChainFor(chainLink);
      }
    }

    return services;
  }

  private findServiceRegistration(
    lifetime: ELifetime,
    token: TServiceToken,
    tag?: string
  ): IServiceRegistration | undefined {
    const normalizedTag = normalizeTagToCompatibleFormat(tag);

    let registry: Map<TServiceToken, ServiceRegistration[]>;
    switch (lifetime) {
      case ELifetime.Singleton:
        registry = this._diConfigurator.singletonServiceRegistry;
        break;
      case ELifetime.Scoped:
        registry = this._diConfigurator.requestScopeServiceRegistry;
        break;
      case ELifetime.Transient:
        registry = this._diConfigurator.transientServiceRegistry;
        break;
    }

    return registry.get(token)?.find((serviceRegistration) => {
      return (
        normalizeTagToCompatibleFormat(serviceRegistration.tag) ===
        normalizedTag
      );
    });
  }

  private createMutexTokenOf(token: TServiceToken, tag?: string): string {
    return `${tokenToString(token)}-${tag ?? DEFAULT_TAG}`;
  }

  // ============================
  // Resolution chain management
  // ============================

  private getCurrentResolutionChain(): ResolutionChain | undefined {
    return AsyncContext.getContext(DI_CONTAINER_RESOLUTION_CHAIN_NAMESPACE) as
      | ResolutionChain
      | undefined;
  }

  private getCurrentResolution(): ResolutionChain {
    const chain = this.getCurrentResolutionChain();
    if (!chain) {
      throw new Error("No resolution chain found. This should not happen.");
    }
    return chain;
  }

  private addToResolutionChainFor(link: IResolutionChainLink): void {
    this.getCurrentResolution().addLink(link);
  }

  private removeFromResolutionChainFor(link: IResolutionChainLink): void {
    this.getCurrentResolution().removeLink(link);
  }
}
