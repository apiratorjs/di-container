import { AsyncContextStore } from "@apiratorjs/async-context";
import { IDiConfigurator, TServiceToken } from "./types";
import { DiDiscoveryService } from "./di-discovery-service";

export class DiContainer {
  public constructor(private readonly _diConfigurator: IDiConfigurator) {}

  public async resolve<T>(token: TServiceToken<T>): Promise<T> {
    return await this._diConfigurator.resolve<T>(token);
  }

  public async runWithNewRequestScope(
    initialStore: AsyncContextStore,
    callback: (diContainer: DiContainer) => Promise<any> | any
  ) {
    return await this._diConfigurator.runWithNewRequestScope(initialStore, () =>
      callback(this)
    );
  }

  public isInRequestScopeContext(): boolean {
    return this._diConfigurator.isInRequestScopeContext();
  }

  public async dispose() {
    await this._diConfigurator.disposeSingletons();
  }

  public getRequestScopeContext(): AsyncContextStore | undefined {
    return this._diConfigurator.getRequestScopeContext();
  }

  public getDiscoveryService(): DiDiscoveryService {
    return this._diConfigurator.getDiscoveryService();
  }
}
