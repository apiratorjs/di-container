import { AsyncContext, AsyncContextStore } from "@apiratorjs/async-context";
import { DiContainer } from "./di-container";
import {
  IBuildOptions,
  IDiConfigurator,
  IDiContainer,
  IDiModule,
  IInitableDiContainer,
  IScopedServiceRegistrationOptions,
  ELifetime,
  TServiceToken,
  TUseFactory,
  ITransientServiceRegistrationOptions,
  ISingletonServiceRegistrationOptions,
} from "./types";
import { normalizeTagToCompatibleFormat } from "./utils";
import { DiDiscoveryService } from "./di-discovery-service";
import {
  ScopedServiceRegistration,
  ServiceRegistration,
} from "./service-registration";
import { CrossLifecycleRegistrationError } from "./errors";
import { DI_CONTAINER_REQUEST_SCOPE_NAMESPACE } from "./constants";

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
  private readonly _discoveryService = new DiDiscoveryService(() =>
    this.listServiceRegistrations()
  );

  public get singletonServiceRegistry() {
    return this._singletonServiceRegistry;
  }

  public get requestScopeServiceRegistry() {
    return this._requestScopeServiceRegistry;
  }

  public get transientServiceRegistry() {
    return this._transientServiceRegistry;
  }

  public addSingleton<T>(
    token: TServiceToken<any>,
    factory: TUseFactory<T>,
    options?: ISingletonServiceRegistrationOptions
  ) {
    const normalizedTag = normalizeTagToCompatibleFormat(options?.tag);

    this.checkForCrossLifecycleRegistration(
      token,
      ELifetime.Singleton,
      normalizedTag
    );

    const serviceRegistrationList =
      this._singletonServiceRegistry.get(token) ?? [];

    const existingRegistrationIndex = serviceRegistrationList.findIndex(
      (serviceRegistration) => {
        return (
          normalizeTagToCompatibleFormat(serviceRegistration.tag) ===
          normalizeTagToCompatibleFormat(normalizedTag)
        );
      }
    );

    if (existingRegistrationIndex !== -1) {
      // Remove existing registration (last registration wins)
      serviceRegistrationList.splice(existingRegistrationIndex, 1);
    }

    const serviceRegistration = new ServiceRegistration({
      token,
      factory,
      lifetime: ELifetime.Singleton,
      tag: normalizedTag,
      singletonOptions: options,
    });

    serviceRegistrationList.push(serviceRegistration);

    this._singletonServiceRegistry.set(token, serviceRegistrationList);

    return this;
  }

  public addScoped<T>(
    token: TServiceToken<any>,
    factory: TUseFactory<T>,
    options?: IScopedServiceRegistrationOptions
  ) {
    const normalizedTag = normalizeTagToCompatibleFormat(options?.tag);

    this.checkForCrossLifecycleRegistration(
      token,
      ELifetime.Scoped,
      normalizedTag
    );

    const serviceRegistrationList =
      this._requestScopeServiceRegistry.get(token) ?? [];

    const existingRegistrationIndex = serviceRegistrationList.findIndex(
      (serviceRegistration) => {
        return (
          normalizeTagToCompatibleFormat(serviceRegistration.tag) ===
          normalizeTagToCompatibleFormat(normalizedTag)
        );
      }
    );

    if (existingRegistrationIndex !== -1) {
      // Remove existing registration (last registration wins)
      serviceRegistrationList.splice(existingRegistrationIndex, 1);
    }

    const serviceRegistration = new ScopedServiceRegistration({
      token,
      factory,
      lifetime: ELifetime.Scoped,
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
    options?: ITransientServiceRegistrationOptions
  ) {
    const normalizedTag = normalizeTagToCompatibleFormat(options?.tag);

    this.checkForCrossLifecycleRegistration(
      token,
      ELifetime.Transient,
      normalizedTag
    );

    const serviceRegistrationList =
      this._transientServiceRegistry.get(token) ?? [];

    const existingRegistrationIndex = serviceRegistrationList.findIndex(
      (serviceRegistration) => {
        return (
          normalizeTagToCompatibleFormat(serviceRegistration.tag) ===
          normalizeTagToCompatibleFormat(normalizedTag)
        );
      }
    );

    if (existingRegistrationIndex !== -1) {
      // Remove existing registration (last registration wins)
      serviceRegistrationList.splice(existingRegistrationIndex, 1);
    }

    const serviceRegistration = new ServiceRegistration({
      token,
      factory,
      lifetime: ELifetime.Transient,
      tag: normalizedTag,
    });

    serviceRegistrationList.push(serviceRegistration);

    this._transientServiceRegistry.set(token, serviceRegistrationList);

    return this;
  }

  public addModule(module: IDiModule) {
    module.register(this);
    return this;
  }

  public async build<T extends IBuildOptions>(
    options: T = { autoInit: true } as T
  ): Promise<
    T extends { autoInit: false } ? IInitableDiContainer : IDiContainer
  > {
    const container = new DiContainer(this);
    if (options.autoInit) {
      await container.init();
    }
    return container;
  }

  public getDiscoveryService(): DiDiscoveryService {
    return this._discoveryService;
  }

  public getRequestScopeContext(): AsyncContextStore | undefined {
    return AsyncContext.getContext(DI_CONTAINER_REQUEST_SCOPE_NAMESPACE);
  }

  private checkForCrossLifecycleRegistration(
    token: TServiceToken,
    attemptedLifecycle: ELifetime,
    tag: string
  ): void {
    const registries: {
      lifetime: ELifetime;
      registry: Map<TServiceToken, ServiceRegistration[]>;
    }[] = [
      {
        lifetime: ELifetime.Singleton,
        registry: this._singletonServiceRegistry,
      },
      {
        lifetime: ELifetime.Scoped,
        registry: this._requestScopeServiceRegistry,
      },
      {
        lifetime: ELifetime.Transient,
        registry: this._transientServiceRegistry,
      },
    ];

    for (const { lifetime, registry } of registries) {
      if (lifetime === attemptedLifecycle) {
        continue;
      }

      const serviceRegistrationList = registry.get(token);
      if (serviceRegistrationList && serviceRegistrationList.length > 0) {
        throw new CrossLifecycleRegistrationError(
          token,
          lifetime,
          attemptedLifecycle,
          tag
        );
      }
    }
  }

  private listServiceRegistrations(): ServiceRegistration[] {
    return [
      ...Array.from(this._singletonServiceRegistry.values()).flat(),
      ...Array.from(this._requestScopeServiceRegistry.values()).flat(),
      ...Array.from(this._transientServiceRegistry.values()).flat(),
    ];
  }
}
