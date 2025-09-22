import { AsyncContext, AsyncContextStore } from "@apiratorjs/async-context";
import { DiContainer } from "./di-container";
import {
  IBuildOptions,
  IDiConfigurator,
  IDiModule,
  ISingletonOptions,
  TLifetime,
  TServiceToken,
  TUseFactory
} from "./types";
import { normalizeTagToCompatibleFormat } from "./utils";
import { DiDiscoveryService } from "./di-discovery-service";
import { ScopedServiceRegistration, ServiceRegistration } from "./service-registration";
import { CrossLifecycleRegistrationError } from "./errors";

export const DI_CONTAINER_REQUEST_SCOPE_NAMESPACE =
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
  private readonly _registeredModules = new Set<IDiModule>();
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
    singletonOptions?: ISingletonOptions,
    tag?: string
  ) {
    const normalizedTag = normalizeTagToCompatibleFormat(tag ?? "default");

    this.checkForCrossLifecycleRegistration(token, "singleton", normalizedTag);

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
      singletonOptions
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

    this.checkForCrossLifecycleRegistration(token, "scoped", normalizedTag);

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
      requestScopeContextGetter: () => this.getRequestScopeContext()
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

    this.checkForCrossLifecycleRegistration(token, "transient", normalizedTag);

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
      tag: normalizedTag
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

  public async build({ autoInit }: IBuildOptions = { autoInit: true }): Promise<DiContainer> {
    const container = new DiContainer(this);
    if (autoInit) {
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
    attemptedLifecycle: "singleton" | "scoped" | "transient",
    tag: string
  ): void {
    const registries: {
      lifetime: TLifetime;
      registry: Map<TServiceToken, ServiceRegistration[]>;
    }[] = [
      { lifetime: "singleton", registry: this._singletonServiceRegistry },
      { lifetime: "scoped", registry: this._requestScopeServiceRegistry },
      { lifetime: "transient", registry: this._transientServiceRegistry }
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
          attemptedLifecycle
        );
      }
    }
  }

  private listServiceRegistrations(): ServiceRegistration[] {
    return [
      ...Array.from(this._singletonServiceRegistry.values()).flat(),
      ...Array.from(this._requestScopeServiceRegistry.values()).flat(),
      ...Array.from(this._transientServiceRegistry.values()).flat()
    ];
  }
}
