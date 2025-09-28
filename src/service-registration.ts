import { AsyncContextStore } from "@apiratorjs/async-context";
import {
  IServiceRegistration,
  ISingletonOptions,
  TClassType,
  ELifetime,
  TServiceToken,
  TServiceTokenType,
  TUseFactory,
} from "./types";
import { tokenToType } from "./utils";

interface IServiceRegistrationProps<T = any> {
  token: TServiceToken<T>;
  factory: TUseFactory<T>;
  lifetime: ELifetime;
  tag: string;
  singletonOptions?: ISingletonOptions | undefined;
}

export class ServiceRegistration<T = any> implements IServiceRegistration<T> {
  public readonly tokenType: TServiceTokenType;
  public readonly token: TServiceToken<T>;
  public readonly factory: TUseFactory<T>;
  public readonly lifetime: ELifetime;
  public readonly tag: string;
  public readonly singletonOptions?: ISingletonOptions | undefined;
  public readonly metatype?: TClassType<T> | undefined;

  private _instance: T | undefined;
  private _isResolved: boolean = false;

  constructor(props: IServiceRegistrationProps<T>) {
    const tokenType = tokenToType(props.token);
    this.tokenType = tokenType;
    this.singletonOptions = props.singletonOptions;
    this.metatype =
      tokenType === "class" ? (props.token as TClassType<T>) : undefined;
    this.token = props.token;
    this.factory = props.factory;
    this.lifetime = props.lifetime;
    this.tag = props.tag;
  }

  public get isResolved(): boolean {
    return this._isResolved;
  }

  public clearInstance(): void {
    this._instance = undefined;
    this._isResolved = false;
  }

  public getInstance(): T | undefined {
    return this._instance;
  }

  public setInstance(instance: T): void {
    this._instance = instance;
    this._isResolved = true;
  }
}

export class ScopedServiceRegistration<T = any> extends ServiceRegistration<T> {
  public readonly requestScopeContextGetter: () =>
    | AsyncContextStore
    | undefined;

  constructor(
    props: IServiceRegistrationProps<T> & {
      requestScopeContextGetter: () => AsyncContextStore | undefined;
    }
  ) {
    super(props);
    this.requestScopeContextGetter = props.requestScopeContextGetter;
  }

  public get isResolved(): boolean {
    const instance = this.getInstance();
    return Boolean(instance);
  }

  public getInstance(): T | undefined {
    return this.requestScopeContextGetter()?.get(this.buildStoreKey()) as
      | T
      | undefined;
  }

  public setInstance(instance: T): void {
    this.requestScopeContextGetter()?.set(this.buildStoreKey(), instance);
  }

  public clearInstance(): void {
    this.requestScopeContextGetter()?.delete(this.buildStoreKey());
  }

  private buildStoreKey(): string {
    return `${this.token.toString()}:${this.tag}`;
  }
}
