import { ELifetime, IResolutionChainLink, TServiceToken } from "./types";
import { tokenToString } from "./utils";
import {
  CircularDependencyError,
  LifecycleSingletonScopedDependencyViolationError,
} from "./errors";
import { DEFAULT_TAG } from "./constants";

export class ResolutionChain {
  private _chain: Array<IResolutionChainLink>;

  public constructor() {
    this._chain = new Array<IResolutionChainLink>();
  }

  public addLink(link: IResolutionChainLink): void {
    this.checkForDependencyViolation({
      ...link,
      tag: link.tag ?? DEFAULT_TAG,
    });
    this._chain.push(link);
  }

  public removeLink(link: IResolutionChainLink): void {
    this._chain = this._chain.filter(
      (t) =>
        !(
          t.token === link.token &&
          t.lifetime === link.lifetime &&
          (t.tag ?? DEFAULT_TAG) === (link.tag ?? DEFAULT_TAG)
        )
    );
  }

  public clear(): void {
    this._chain.length = 0;
  }

  public checkForDependencyViolation(link: IResolutionChainLink): void {
    this.checkForCircularDependency(link);
    this.checkForLifecycleDependencyViolation(link);
  }

  private checkForCircularDependency(link: IResolutionChainLink): void {
    if (
      this._chain.some(
        (t) =>
          t.token === link.token &&
          t.lifetime === link.lifetime &&
          t.tag === link.tag
      )
    ) {
      const cycle = this._chain
        .map((t) => tokenToString(t.token))
        .concat(tokenToString(link.token));
      throw new CircularDependencyError(link.token, cycle);
    }
  }

  private checkForLifecycleDependencyViolation(
    link: IResolutionChainLink
  ): void {
    const dependentLink = this._chain[this._chain.length - 1];
    if (!dependentLink) {
      return;
    }

    // Prevent Singleton → Scoped (strict violation)
    if (
      dependentLink.lifetime === ELifetime.Singleton &&
      link.lifetime === ELifetime.Scoped
    ) {
      throw new LifecycleSingletonScopedDependencyViolationError(
        dependentLink.token,
        dependentLink.lifetime,
        link.token,
        link.lifetime
      );
    }

    // Warn about Singleton → Transient (potential issue)
    if (
      dependentLink.lifetime === ELifetime.Singleton &&
      link.lifetime === ELifetime.Transient
    ) {
      console.warn(
        `[DI Container] Lifestyle mismatch warning: Singleton service '${tokenToString(
          dependentLink.token
        )}' depends on Transient service '${tokenToString(
          link.token
        )}'. The transient service will behave as a singleton. Consider using a factory pattern or promoting the dependency to singleton lifetime.`
      );
    }
  }
}
