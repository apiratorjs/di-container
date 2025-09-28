import { AsyncContextStore } from "@apiratorjs/async-context";

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

  resolveAll<T>(token: TServiceToken<T>): Promise<IResolveAllResult<T>[]>;

  resolveTagged<T>(tag: string): Promise<T | undefined>;

  resolveTaggedRequired<T>(tag: string): Promise<T>;

  resolveAllTagged(tag: string): Promise<IResolveAllResult[]>;

  runWithNewRequestScope(
    callback: (diContainer: IDiContainer) => Promise<any> | any,
    initialStore: AsyncContextStore
  ): Promise<void>;

  isInRequestScopeContext(): boolean;

  dispose(): Promise<void>;

  getDiscoveryService(): IDiDiscoveryService;
}

export interface IResolveAllResult<T = any> {
  registration: IServiceRegistration<T>;
  instance: T;
}

export interface IInitableDiContainer extends IDiContainer {
  init(): Promise<void>;
}

export enum ELifetime {
  Singleton = "singleton",
  Scoped = "scoped",
  Transient = "transient",
}

export interface IDiConfigurator {
  addSingleton<T>(
    token: TServiceToken,
    factory: (container: IDiContainer) => Promise<T> | T,
    options?: ISingletonServiceRegistrationOptions
  ): this;

  addScoped<T>(
    token: TServiceToken,
    factory: (diContainer: IDiContainer) => Promise<T> | T,
    options?: IScopedServiceRegistrationOptions
  ): this;

  addTransient<T>(
    token: TServiceToken,
    factory: (diContainer: IDiContainer) => Promise<T> | T,
    options?: ITransientServiceRegistrationOptions
  ): this;

  addModule(module: IDiModule): this;

  build<T extends IBuildOptions>(
    options: T
  ): Promise<
    T extends { autoInit: false } ? IInitableDiContainer : IDiContainer
  >;

  getDiscoveryService(): IDiDiscoveryService;
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
  lifetime: ELifetime;
  factory: TUseFactory<T>;
  singletonOptions?: ISingletonOptions;
  isResolved: boolean;
  tag: string;
  metatype?: TClassType<T>;
  getInstance(): T | undefined;
}

export interface IBuildOptions {
  autoInit?: boolean;
}

export interface IDiDiscoveryService {
  getAll(): IServiceRegistration[];
  getServicesByTag(tag: string): IServiceRegistration[];
  getServicesByServiceToken(
    serviceToken: TServiceToken
  ): IServiceRegistration[];
  getServicesByLifetime(lifetime: ELifetime): IServiceRegistration[];
}

export interface IDiModule {
  register(configurator: IDiConfigurator): void;
}

export interface IServiceRegistrationOptions {
  tag?: string;
}

export interface ISingletonServiceRegistrationOptions
  extends IServiceRegistrationOptions {
  eager?: boolean;
}

export interface IScopedServiceRegistrationOptions
  extends IServiceRegistrationOptions {}

export interface ITransientServiceRegistrationOptions
  extends IServiceRegistrationOptions {}
