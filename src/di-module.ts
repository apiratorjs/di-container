import { DiConfigurator } from "./di-configurator";
import { IDiConfigurator, IDiModule, Lifetime, ModuleOptions, ServiceToken } from "./types";

export class DiModule implements IDiModule {
  constructor(private readonly options: ModuleOptions) {}

  static create(options: ModuleOptions): DiModule {
    return new DiModule(options);
  }

  register(configurator: IDiConfigurator): void {
    if (this.options.imports) {
      for (const importedModule of this.options.imports) {
        configurator.addModule(importedModule);
      }
    }

    if (this.options.providers) {
      for (const provider of this.options.providers) {
        this.registerProvider(provider, configurator);
      }
    }
  }

  private registerProvider(
    provider: {
      token: ServiceToken;
      useFactory: (container: DiConfigurator) => Promise<any> | any;
      lifetime: Lifetime;
    },
    configurator: IDiConfigurator
  ): void {
    const { token, useFactory, lifetime } = provider;

    this.registerByLifetime(token, useFactory, lifetime, configurator);
  }

  private registerByLifetime(
    token: ServiceToken,
    factory: (container: DiConfigurator) => Promise<any> | any,
    lifetime: Lifetime,
    configurator: IDiConfigurator
  ): void {
    switch (lifetime) {
      case "singleton":
        configurator.addSingleton(token, factory);
        break;

      case "scoped":
        configurator.addScoped(token, factory);
        break;

      case "transient":
        configurator.addTransient(token, factory);
        break;

      default:
        throw new Error(`Unknown lifetime: ${lifetime}`);
    }
  }
}
