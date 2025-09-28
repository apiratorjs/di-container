import {
  IDiDiscoveryService,
  IServiceRegistration,
  ELifetime,
  TServiceToken,
} from "./types";

export class DiDiscoveryService implements IDiDiscoveryService {
  constructor(
    private readonly _serviceRegistrationsGetter: () => IServiceRegistration[]
  ) {}

  public getAll(): IServiceRegistration[] {
    return this._serviceRegistrationsGetter();
  }

  public getServicesByTag(tag: string): IServiceRegistration[] {
    return this._serviceRegistrationsGetter().filter(
      (serviceRegistration) => serviceRegistration.tag === tag
    );
  }

  public getServicesByServiceToken(
    serviceToken: TServiceToken
  ): IServiceRegistration[] {
    return this._serviceRegistrationsGetter().filter(
      (serviceRegistration) => serviceRegistration.token === serviceToken
    );
  }

  public getServicesByLifetime(lifetime: ELifetime): IServiceRegistration[] {
    return this._serviceRegistrationsGetter().filter(
      (serviceRegistration) => serviceRegistration.lifetime === lifetime
    );
  }
}
