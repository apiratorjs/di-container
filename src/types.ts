import { DiConfigurator } from "./di-configurator";
import { AsyncContextStore } from "@apiratorjs/async-context";
import { DiContainer } from "./di-container";

export type ClassType<T = any> = new (...args: any[]) => T;
/**
 * A service token can be a string, symbol, or a class constructor.
 */
export type ServiceToken<T = any> = string | symbol | ClassType<T>;

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

export interface IDiConfigurator {
  addSingleton<T>(
    token: ServiceToken,
    factory: (container: DiConfigurator) => Promise<T> | T
  ): this;

  disposeSingletons(): Promise<void>;

  addScoped<T>(
    token: ServiceToken,
    factory: (diConfigurator: DiConfigurator) => Promise<T> | T
  ): this;

  addTransient<T>(
    token: ServiceToken,
    factory: (diConfigurator: DiConfigurator) => Promise<T> | T
  ): this;

  resolve<T>(token: ServiceToken<T>): Promise<T>;

  runWithNewRequestScope(
    initialStore: AsyncContextStore,
    callback: () => Promise<any> | any
  ): Promise<void>;

  getRequestScopeContext(): AsyncContextStore | undefined;

  build(): DiContainer;

  isInRequestScopeContext(): boolean;
}
