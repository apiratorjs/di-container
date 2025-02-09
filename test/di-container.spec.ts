import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AsyncContextStore } from "@apiratorjs/async-context";
import { DiConfigurator, DiContainer } from "../src";
import { IOnConstruct, IOnDispose, ServiceToken } from "../src/types";

describe("DiContainer", () => {
  const SINGLETON_TOKEN: ServiceToken = "SINGLETON_TOKEN";
  const SCOPED_TOKEN: ServiceToken = "SCOPED_TOKEN";
  const TRANSIENT_TOKEN: ServiceToken = "TRANSIENT_TOKEN";
  const SCOPED_WITH_HOOKS: ServiceToken = "SCOPED_WITH_HOOKS";

  let diConfigurator: DiConfigurator;
  let diContainer: DiContainer;
  let singletonBuildCount: number;
  let scopedBuildCount: number;
  let transientBuildCount: number;

  const runScope = async (callback: () => Promise<any>) => {
    return await diConfigurator.runWithNewRequestScope(new AsyncContextStore(), callback);
  };

  beforeEach(() => {
    diConfigurator = new DiConfigurator();
    singletonBuildCount = 0;
    scopedBuildCount = 0;
    transientBuildCount = 0;

    // Register services
    diConfigurator.addSingleton(SINGLETON_TOKEN, async () => {
      singletonBuildCount++;
      return { name: "singleton-service" };
    });

    diConfigurator.addScoped(SCOPED_TOKEN, async () => {
      scopedBuildCount++;
      return { name: "scoped-service" };
    });

    diConfigurator.addTransient(TRANSIENT_TOKEN, async () => {
      transientBuildCount++;
      return { name: "transient-service" };
    });

    diContainer = diConfigurator.build();
  });

  afterEach(async () => {
    await diContainer.dispose();
  });

  // ============================================================
  // SINGLETON TESTS
  // ============================================================
  describe("Singleton", () => {
    it("should lazily instantiate a singleton only once", async () => {
      assert.equal(singletonBuildCount, 0);

      const instance1 = await diConfigurator.resolve(SINGLETON_TOKEN);
      assert.equal(singletonBuildCount, 1);

      const instance2 = await diConfigurator.resolve(SINGLETON_TOKEN);
      assert.equal(singletonBuildCount, 1);
      assert.strictEqual(instance1, instance2);
    });

    it("should not create multiple singletons in parallel (no race condition)", async () => {
      // Run resolves concurrently
      const [resA, resB, resC] = await Promise.all([
        diConfigurator.resolve(SINGLETON_TOKEN),
        diConfigurator.resolve(SINGLETON_TOKEN),
        diConfigurator.resolve(SINGLETON_TOKEN)
      ]);

      assert.equal(singletonBuildCount, 1);
      assert.strictEqual(resA, resB);
      assert.strictEqual(resB, resC);
    });
  });

  // ============================================================
  // SCOPED TESTS
  // ============================================================
  describe("Scoped", () => {
    it("should throw if resolving scoped service outside of a request scope", async () => {
      await assert.rejects(
        diConfigurator.resolve(SCOPED_TOKEN),
        /Cannot resolve request-scoped service/
      );
      assert.equal(scopedBuildCount, 0);
    });

    it("should resolve a scoped service once per scope", async () => {
      let firstScopeInstance: any;
      await runScope(async () => {
        firstScopeInstance = await diConfigurator.resolve(SCOPED_TOKEN);
        assert.deepEqual(firstScopeInstance, { name: "scoped-service" });
        assert.equal(scopedBuildCount, 1);
      });

      let secondScopeInstance: any;
      await runScope(async () => {
        secondScopeInstance = await diConfigurator.resolve(SCOPED_TOKEN);
        assert.deepEqual(secondScopeInstance, { name: "scoped-service" });
      });

      // Two different scopes should result in two builds.
      assert.equal(scopedBuildCount, 2);
      assert.notStrictEqual(firstScopeInstance, secondScopeInstance);
    });

    it("should not create multiple scoped instances in parallel within the same scope", async () => {
      await runScope(async () => {
        const [resA, resB, resC] = await Promise.all([
          diConfigurator.resolve(SCOPED_TOKEN),
          diConfigurator.resolve(SCOPED_TOKEN),
          diConfigurator.resolve(SCOPED_TOKEN)
        ]);

        assert.equal(scopedBuildCount, 1);
        assert.strictEqual(resA, resB);
        assert.strictEqual(resB, resC);
      });
    });

    it("should return a value from runWithNewRequestScope", async () => {
      const returnValue = await runScope(async () => {
        return Promise.resolve("scope-result");
      });
      assert.equal(returnValue, "scope-result");
    });

    it("should throw with correct error message when resolving a scoped service outside a request scope", async () => {
      await assert.rejects(
        diConfigurator.resolve(SCOPED_TOKEN),
        (err: Error) => {
          assert.match(
            err.message,
            /Cannot resolve request-scoped service '.*' outside of a request scope\. It is likely that a singleton or transient service is trying to inject a request-scoped dependency\./
          );
          return true;
        }
      );
    });
  });

  // ============================================================
  // TRANSIENT TESTS
  // ============================================================
  describe("Transient", () => {
    it("should create a new transient instance every time", async () => {
      const t1 = await diConfigurator.resolve(TRANSIENT_TOKEN);
      const t2 = await diConfigurator.resolve(TRANSIENT_TOKEN);

      assert.notStrictEqual(t1, t2);
      assert.equal(transientBuildCount, 2);
    });

    it("should create separate transients under concurrency", async () => {
      const [r1, r2] = await Promise.all([
        diConfigurator.resolve(TRANSIENT_TOKEN),
        diConfigurator.resolve(TRANSIENT_TOKEN)
      ]);

      assert.equal(transientBuildCount, 2);
      assert.notStrictEqual(r1, r2);
    });
  });

  // ============================================================
  // LIFECYCLE HOOKS TESTS
  // ============================================================
  describe("Lifecycle Hooks", () => {
    describe("Singleton Hooks", () => {
      it("should call onConstruct and onDispose for a singleton if implemented", async () => {
        let onConstructCount = 0;
        let onDisposeCount = 0;

        diConfigurator.addSingleton("HOOKED_SINGLETON", async () => {
          const service: IOnConstruct & IOnDispose = {
            onConstruct() {
              onConstructCount++;
            },
            onDispose() {
              onDisposeCount++;
            }
          };
          return service;
        });

        await diConfigurator.resolve("HOOKED_SINGLETON");
        assert.equal(onConstructCount, 1);

        await diConfigurator.disposeSingletons();
        assert.equal(onDisposeCount, 1);
      });
    });

    describe("Scoped Hooks", () => {
      it("should call onConstruct once per scope and onDispose once when scope ends", async () => {
        let onConstructCount = 0;
        let onDisposeCount = 0;

        diConfigurator.addScoped(SCOPED_WITH_HOOKS, async () => {
          const service: IOnConstruct & IOnDispose = {
            onConstruct() {
              onConstructCount++;
            },
            onDispose() {
              onDisposeCount++;
            }
          };
          return service;
        });

        // 1st scope
        await runScope(async () => {
          const service1 = await diConfigurator.resolve(SCOPED_WITH_HOOKS);
          assert.equal(onConstructCount, 1, "onConstruct should be called for 1st scope");

          // Multiple resolves in the same scope return the same instance.
          const [service2, service3] = await Promise.all([
            diConfigurator.resolve(SCOPED_WITH_HOOKS),
            diConfigurator.resolve(SCOPED_WITH_HOOKS)
          ]);
          assert.equal(onConstructCount, 1, "still only one onConstruct call in 1st scope");
          assert.strictEqual(service1, service2);
          assert.strictEqual(service2, service3);
        });

        // After the first scope ends, onDispose should have been called once.
        assert.equal(onDisposeCount, 1, "onDispose called once after 1st scope");

        // 2nd scope
        await runScope(async () => {
          const service4 = await diConfigurator.resolve(SCOPED_WITH_HOOKS);
          assert.equal(onConstructCount, 2, "onConstruct should be called again in 2nd scope");

          const service5 = await diConfigurator.resolve(SCOPED_WITH_HOOKS);
          assert.equal(onConstructCount, 2, "no additional onConstruct in same scope");
          assert.strictEqual(service4, service5);
        });

        // After the second scope ends, onDispose should have been called one more time.
        assert.equal(onDisposeCount, 2, "onDispose called once after 2nd scope");
      });
    });
  });
});
