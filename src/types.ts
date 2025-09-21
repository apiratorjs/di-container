import { AsyncContextStore } from "@apiratorjs/async-context";
import { DiContainer } from "./di-container";
import { DiDiscoveryService } from "./di-discovery-service";

export type TClassType<T = any> = new (...args: any[]) => T;
/**
 * A service token can be a string, symbol, or a class constructor.
 */
export type TServiceToken<T = any> = string | symbol | TClassType<T>;

export type TNormalizedServiceToken = string | symbol;

/**
 * The type of the service token.
 */
export type TServiceTokenType = "string" | "symbol" | "class";

/**
 * All services can be initialized.
 */
export interface IOnConstruct {
  onConstruct(): Promise<void> | void;
}

/**
 * Only singleton and request scoped services can be disposable.
 */
export interface IOnDispose {
  onDispose(): Promise<void> | void;
}

export interface IDiContainer {
  resolve<T>(token: TServiceToken<T>, tag?: string): Promise<T | undefined>;

  resolveRequired<T>(token: TServiceToken<T>, tag?: string): Promise<T>;

  resolveAll<T>(token: TServiceToken<T>): Promise<T[]>;

  resolveTagged<T>(tag: string): Promise<T | undefined>;

  resolveTaggedRequired<T>(tag: string): Promise<T>;

  resolveAllTagged<T>(tag: string): Promise<T[]>;

  runWithNewRequestScope(
    callback: (diContainer: IDiContainer) => Promise<any> | any,
    initialStore: AsyncContextStore
  ): Promise<void>;

  isInRequestScopeContext(): boolean;

  dispose(): Promise<void>;

  getDiscoveryService(): DiDiscoveryService;
}

export interface IDiModule {
  register(configurator: IDiConfigurator): void;
}

export type TLifetime = "singleton" | "scoped" | "transient";

export interface IModuleOptions {
  imports?: IDiModule[];
  providers?: Array<{
    token: TServiceToken;
    useFactory: (container: IDiContainer) => Promise<any> | any;
    lifetime: TLifetime;
    singletonOptions?: ISingletonOptions;
    tag?: string;
  }>;
}

export interface IDiConfigurator {
  addSingleton<T>(
    token: TServiceToken,
    factory: (container: IDiContainer) => Promise<T> | T,
    singletonOptions?: ISingletonOptions,
    tag?: string
  ): this;

  addScoped<T>(
    token: TServiceToken,
    factory: (diContainer: IDiContainer) => Promise<T> | T,
    tag?: string
  ): this;

  addTransient<T>(
    token: TServiceToken,
    factory: (diContainer: IDiContainer) => Promise<T> | T,
    tag?: string
  ): this;

  addModule(module: IDiModule): this;

  build(): Promise<DiContainer>;

  getDiscoveryService(): DiDiscoveryService;
}

export interface ISingletonOptions {
  /**
   * Should the singleton be eagerly created during container build
   */
  eager?: boolean;
}

export type TUseFactory<T> = (diContainer: IDiContainer) => Promise<T> | T;

export interface IServiceRegistration<T = any> {
  token: TServiceToken<T>;
  tokenType: TServiceTokenType;
  lifetime: TLifetime;
  factory: TUseFactory<T>;
  singletonOptions?: ISingletonOptions;
  isResolved: boolean;
  tag: string;
  metatype?: TClassType<T>;
  getInstance(): T | undefined;
}
