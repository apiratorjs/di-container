import {
  IDiConfigurator,
  IDiModule,
  TLifetime,
  IModuleOptions,
  TServiceToken,
  ISingletonOptions,
  IDiContainer,
} from "./types";

export class DiModule implements IDiModule {
  constructor(private readonly options: IModuleOptions) {}

  static create(options: IModuleOptions): DiModule {
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
      token: TServiceToken;
      useFactory: (container: IDiContainer) => Promise<any> | any;
      lifetime: TLifetime;
      singletonOptions?: ISingletonOptions;
      tag?: string;
    },
    configurator: IDiConfigurator
  ): void {
    const { token, useFactory, lifetime, singletonOptions, tag } = provider;

    this.registerByLifetime(
      token,
      useFactory,
      lifetime,
      configurator,
      singletonOptions,
      tag
    );
  }

  private registerByLifetime(
    token: TServiceToken,
    factory: (container: IDiContainer) => Promise<any> | any,
    lifetime: TLifetime,
    configurator: IDiConfigurator,
    singletonOptions?: ISingletonOptions,
    tag?: string
  ): void {
    switch (lifetime) {
      case "singleton":
        configurator.addSingleton(token, factory, singletonOptions, tag);
        break;

      case "scoped":
        configurator.addScoped(token, factory, tag);
        break;

      case "transient":
        configurator.addTransient(token, factory, tag);
        break;

      default:
        throw new Error(`Unknown lifetime: ${lifetime}`);
    }
  }
}
