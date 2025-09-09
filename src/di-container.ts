import { AsyncContextStore } from "@apiratorjs/async-context";
import { IDiConfigurator, IDiContainer, TServiceToken } from "./types";
import { DiDiscoveryService } from "./di-discovery-service";

export class DiContainer implements IDiContainer {
  public constructor(private readonly _diConfigurator: IDiConfigurator) {}

  public async resolve<T>(token: TServiceToken<T>): Promise<T> {
    return await this._diConfigurator.resolve<T>(token);
  }

  public async runWithNewRequestScope(
    initialStore: AsyncContextStore,
    callback: (diContainer: IDiContainer) => Promise<any> | any
  ): Promise<void> {
    await this._diConfigurator.runWithNewRequestScope(initialStore, () =>
      callback(this)
    );
  }

  public isInRequestScopeContext(): boolean {
    return this._diConfigurator.isInRequestScopeContext();
  }

  public async dispose(): Promise<void> {
    await this._diConfigurator.dispose();
  }

  public getRequestScopeContext(): AsyncContextStore | undefined {
    return this._diConfigurator.getRequestScopeContext();
  }

  public getDiscoveryService(): DiDiscoveryService {
    return this._diConfigurator.getDiscoveryService();
  }

  public async resolveAll<T>(
    token: TServiceToken<T>,
    tag?: string
  ): Promise<T[]> {
    return await this._diConfigurator.resolveAll<T>(token, tag);
  }

  public async resolveTagged<T>(tag: string): Promise<T> {
    return await this._diConfigurator.resolveTagged<T>(tag);
  }

  public async resolveAllTagged<T>(tag: string): Promise<T[]> {
    return await this._diConfigurator.resolveAllTagged<T>(tag);
  }
}
