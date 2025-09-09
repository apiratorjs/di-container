import { DiConfigurator } from "./di-configurator";
import { AsyncContextStore } from "@apiratorjs/async-context";
import { DiContainer } from "./di-container";
import { DiDiscoveryService } from "./di-discovery-service";

export type TClassType<T = any> = new (...args: any[]) => T;
/**
 * A service token can be a string, symbol, or a class constructor.
 */
export type TServiceToken<T = any> = string | symbol | TClassType<T>;

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
  resolve<T>(token: TServiceToken<T>): Promise<T>;

  runWithNewRequestScope(
    initialStore: AsyncContextStore,
    callback: (diContainer: IDiContainer) => Promise<any> | any
  ): Promise<void>;

  isInRequestScopeContext(): boolean;

  dispose(): Promise<void>;

  getRequestScopeContext(): AsyncContextStore | undefined;

  getDiscoveryService(): DiDiscoveryService;

  resolveAll<T>(token: TServiceToken<T>, tag?: string): Promise<T[]>;

  resolveTagged<T>(tag: string): Promise<T>;

  resolveAllTagged<T>(tag: string): Promise<T[]>;
}

export interface IDiModule {
  register(configurator: IDiConfigurator): void;
}

export type TLifetime = "singleton" | "scoped" | "transient";

export interface IModuleOptions {
  imports?: IDiModule[];
  providers?: Array<{
    token: TServiceToken;
    useFactory: (container: DiConfigurator) => Promise<any> | any;
    lifetime: TLifetime;
    singletonOptions?: ISingletonOptions;
  }>;
}

export interface IDiConfigurator {
  addSingleton<T>(
    token: TServiceToken,
    factory: (container: DiConfigurator) => Promise<T> | T,
    singletonOptions?: ISingletonOptions,
    tag?: string
  ): this;

  addScoped<T>(
    token: TServiceToken,
    factory: (diConfigurator: DiConfigurator) => Promise<T> | T,
    tag?: string
  ): this;

  addTransient<T>(
    token: TServiceToken,
    factory: (diConfigurator: DiConfigurator) => Promise<T> | T,
    tag?: string
  ): this;

  addModule(module: IDiModule): this;

  resolve<T>(token: TServiceToken<T>, tag?: string): Promise<T>;

  resolveAll<T>(token: TServiceToken<T>, tag?: string): Promise<T[]>;

  resolveTagged<T>(tag: string): Promise<T>;

  resolveAllTagged<T>(tag: string): Promise<T[]>;

  dispose(): Promise<void>;

  runWithNewRequestScope(
    initialStore: AsyncContextStore,
    callback: () => Promise<any> | any
  ): Promise<void>;

  getRequestScopeContext(): AsyncContextStore | undefined;

  build(): Promise<DiContainer>;

  isInRequestScopeContext(): boolean;

  getDiscoveryService(): DiDiscoveryService;
}

export interface ISingletonOptions {
  /**
   * Should the singleton be eagerly created during container build
   */
  eager?: boolean;
}

export type TUseFactory<T> = (diConfigurator: DiConfigurator) => Promise<T> | T;

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
  setInstance(instance: T): void;
  clearInstance(): void;
}
