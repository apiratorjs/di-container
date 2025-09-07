import {
  IDiscoveryServiceQuery,
  IServiceRegistration,
  TLifetime,
  TServiceToken,
} from "./types";

export class DiDiscoveryService {
  constructor(
    private readonly _serviceRegistrationsGetter: () => IServiceRegistration[]
  ) {}

  getAll(query: IDiscoveryServiceQuery): IServiceRegistration[] {
    return this._serviceRegistrationsGetter();
  }

  getServicesByTag(tag: string): IServiceRegistration[] {
    return this._serviceRegistrationsGetter().filter(
      (serviceRegistration) => serviceRegistration.tag === tag
    );
  }

  getServicesByServiceToken(
    serviceToken: TServiceToken
  ): IServiceRegistration[] {
    return this._serviceRegistrationsGetter().filter(
      (serviceRegistration) => serviceRegistration.token === serviceToken
    );
  }

  getServicesByLifetime(lifetime: TLifetime): IServiceRegistration[] {
    return this._serviceRegistrationsGetter().filter(
      (serviceRegistration) => serviceRegistration.lifetime === lifetime
    );
  }
}
