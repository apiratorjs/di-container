import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { AsyncContextStore } from "@apiratorjs/async-context";
import {
  CircularDependencyError,
  DiConfigurator,
  DiContainer,
  IOnConstruct,
  IOnDispose,
  TServiceToken,
} from "../src";

describe("DiContainer", () => {
  const LAZY_SINGLETON_TOKEN: TServiceToken = "LAZY_SINGLETON_TOKEN";
  const EAGER_SINGLETON_TOKEN: TServiceToken = "EAGER_SINGLETON_TOKEN";
  const SCOPED_TOKEN: TServiceToken = "SCOPED_TOKEN";
  const TRANSIENT_TOKEN: TServiceToken = "TRANSIENT_TOKEN";
  const SCOPED_WITH_HOOKS: TServiceToken = "SCOPED_WITH_HOOKS";

  let diConfigurator: DiConfigurator;
  let diContainer: DiContainer;
  let lazySingletonBuildCount: number;
  let eagerSingletonBuildCount: number;
  let scopedBuildCount: number;
  let transientBuildCount: number;

  const runScope = async (callback: () => Promise<any>) => {
    return await diConfigurator.runWithNewRequestScope(
      new AsyncContextStore(),
      callback
    );
  };

  beforeEach(async () => {
    diConfigurator = new DiConfigurator();
    lazySingletonBuildCount = 0;
    eagerSingletonBuildCount = 0;
    scopedBuildCount = 0;
    transientBuildCount = 0;

    // Register services
    diConfigurator.addSingleton(LAZY_SINGLETON_TOKEN, async () => {
      lazySingletonBuildCount++;
      return { name: "lazy-singleton-service" };
    }); // Default is lazy (no eager option)

    diConfigurator.addSingleton(
      EAGER_SINGLETON_TOKEN,
      async () => {
        eagerSingletonBuildCount++;
        return { name: "eager-singleton-service" };
      },
      { eager: true }
    );

    diConfigurator.addScoped(SCOPED_TOKEN, async () => {
      scopedBuildCount++;
      return { name: "scoped-service" };
    });

    diConfigurator.addTransient(TRANSIENT_TOKEN, async () => {
      transientBuildCount++;
      return { name: "transient-service" };
    });

    diContainer = await diConfigurator.build();
  });

  afterEach(async () => {
    await diContainer.dispose();
  });

  // ============================================================
  // SINGLETON TESTS
  // ============================================================
  describe("Singleton", () => {
    describe("Lazy Singleton (default behavior)", () => {
      it("should lazily instantiate a singleton only once", async () => {
        // Lazy singleton should not be built during container build
        assert.equal(lazySingletonBuildCount, 0);

        const instance1 = await diConfigurator.resolve(LAZY_SINGLETON_TOKEN);
        assert.equal(lazySingletonBuildCount, 1);

        const instance2 = await diConfigurator.resolve(LAZY_SINGLETON_TOKEN);
        assert.equal(lazySingletonBuildCount, 1);
        assert.strictEqual(instance1, instance2);
      });

      it("should not create multiple lazy singletons in parallel (no race condition)", async () => {
        // Run resolves concurrently
        const [resA, resB, resC] = await Promise.all([
          diConfigurator.resolve(LAZY_SINGLETON_TOKEN),
          diConfigurator.resolve(LAZY_SINGLETON_TOKEN),
          diConfigurator.resolve(LAZY_SINGLETON_TOKEN),
        ]);

        assert.equal(lazySingletonBuildCount, 1);
        assert.ok(resA === resB);
        assert.ok(resB === resC);

        const resD = await diConfigurator.resolve(LAZY_SINGLETON_TOKEN);
        assert.ok(resA === resD);
      });
    });

    describe("Eager Singleton", () => {
      it("should eagerly instantiate a singleton during build", async () => {
        // Eager singleton should be built during container build
        assert.equal(eagerSingletonBuildCount, 1);

        const instance1 = await diConfigurator.resolve(EAGER_SINGLETON_TOKEN);
        assert.equal(eagerSingletonBuildCount, 1);

        const instance2 = await diConfigurator.resolve(EAGER_SINGLETON_TOKEN);
        assert.equal(eagerSingletonBuildCount, 1);
        assert.strictEqual(instance1, instance2);
      });

      it("should not create multiple eager singletons in parallel (no race condition)", async () => {
        // Should already be built once during container build
        assert.equal(eagerSingletonBuildCount, 1);

        // Run resolves concurrently
        const [resA, resB, resC] = await Promise.all([
          diConfigurator.resolve(EAGER_SINGLETON_TOKEN),
          diConfigurator.resolve(EAGER_SINGLETON_TOKEN),
          diConfigurator.resolve(EAGER_SINGLETON_TOKEN),
        ]);

        // Should still be only built once
        assert.equal(eagerSingletonBuildCount, 1);
        assert.ok(resA === resB);
        assert.ok(resB === resC);

        const resD = await diConfigurator.resolve(EAGER_SINGLETON_TOKEN);
        assert.ok(resA === resD);
      });
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
          diConfigurator.resolve(SCOPED_TOKEN),
        ]);

        assert.equal(scopedBuildCount, 1);
        assert.ok(resA === resB);
        assert.ok(resB === resC);

        const resD = await diConfigurator.resolve(SCOPED_TOKEN);
        assert.ok(resA === resD);
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
            /Cannot resolve request-scoped service for token '.*' outside of a request scope\. It is likely that a singleton or transient service is trying to inject a request-scoped dependency\./
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
        diConfigurator.resolve(TRANSIENT_TOKEN),
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
            },
          };
          return service;
        });

        await diConfigurator.resolve("HOOKED_SINGLETON");
        assert.equal(onConstructCount, 1);

        await diConfigurator.dispose();
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
            },
          };
          return service;
        });

        // 1st scope
        await runScope(async () => {
          const service1 = await diConfigurator.resolve(SCOPED_WITH_HOOKS);
          assert.equal(
            onConstructCount,
            1,
            "onConstruct should be called for 1st scope"
          );

          // Multiple resolves in the same scope return the same instance.
          const [service2, service3] = await Promise.all([
            diConfigurator.resolve(SCOPED_WITH_HOOKS),
            diConfigurator.resolve(SCOPED_WITH_HOOKS),
          ]);
          assert.equal(
            onConstructCount,
            1,
            "still only one onConstruct call in 1st scope"
          );
          assert.strictEqual(service1, service2);
          assert.strictEqual(service2, service3);
        });

        // After the first scope ends, onDispose should have been called once.
        assert.equal(
          onDisposeCount,
          1,
          "onDispose called once after 1st scope"
        );

        // 2nd scope
        await runScope(async () => {
          const service4 = await diConfigurator.resolve(SCOPED_WITH_HOOKS);
          assert.equal(
            onConstructCount,
            2,
            "onConstruct should be called again in 2nd scope"
          );

          const service5 = await diConfigurator.resolve(SCOPED_WITH_HOOKS);
          assert.equal(
            onConstructCount,
            2,
            "no additional onConstruct in same scope"
          );
          assert.strictEqual(service4, service5);
        });

        // After the second scope ends, onDispose should have been called one more time.
        assert.equal(
          onDisposeCount,
          2,
          "onDispose called once after 2nd scope"
        );
      });
    });
  });

  describe("Circular Dependencies", () => {
    it("should detect and throw CircularDependencyError for direct circular dependency", async () => {
      const CIRCULAR_A = "CIRCULAR_A";
      const CIRCULAR_B = "CIRCULAR_B";

      // A depends on B, B depends on A
      diConfigurator.addSingleton(CIRCULAR_A, async (di) => {
        await di.resolve(CIRCULAR_B);
        return { name: "service-a" };
      });

      diConfigurator.addSingleton(CIRCULAR_B, async (di) => {
        await di.resolve(CIRCULAR_A);
        return { name: "service-b" };
      });

      await assert.rejects(diConfigurator.resolve(CIRCULAR_A), (err: any) => {
        assert.ok(err instanceof CircularDependencyError);
        assert.ok(
          err.chain?.includes(CIRCULAR_A),
          "Error chain should include token A"
        );
        assert.ok(
          err.chain?.includes(CIRCULAR_B),
          "Error chain should include token B"
        );
        return true;
      });
    });

    it("should detect and throw CircularDependencyError for indirect circular dependencies", async () => {
      const CIRCULAR_B = "CIRCULAR_B";
      const CIRCULAR_C = "CIRCULAR_C";
      const CIRCULAR_D = "CIRCULAR_D";

      // Service B depends on C, C depends on D, D depends on B (creating a cycle)
      diConfigurator.addSingleton(CIRCULAR_B, async (di) => {
        await di.resolve(CIRCULAR_C);
        return { name: "service-b" };
      });

      diConfigurator.addSingleton(CIRCULAR_C, async (di) => {
        await di.resolve(CIRCULAR_D);
        return { name: "service-c" };
      });

      diConfigurator.addSingleton(CIRCULAR_D, async (di) => {
        await di.resolve(CIRCULAR_B);
        return { name: "service-d" };
      });

      await assert.rejects(diConfigurator.resolve(CIRCULAR_B), (err: any) => {
        assert.ok(err instanceof CircularDependencyError);
        const chain = err.chain;
        assert.ok(Array.isArray(chain), "Error chain should be an array");

        // Verify the circular dependency chain
        assert.ok(chain.includes(CIRCULAR_B), "Chain should include B");
        assert.ok(chain.includes(CIRCULAR_C), "Chain should include C");
        assert.ok(chain.includes(CIRCULAR_D), "Chain should include D");

        return true;
      });
    });

    it("should not throw for non-circular dependencies", async () => {
      const NON_CIRCULAR_A = "NON_CIRCULAR_A";
      const NON_CIRCULAR_B = "NON_CIRCULAR_B";

      diConfigurator.addSingleton(NON_CIRCULAR_A, async (di) => {
        await di.resolve(NON_CIRCULAR_B);
        return { name: "service-a" };
      });

      diConfigurator.addSingleton(NON_CIRCULAR_B, async () => {
        return { name: "service-b" };
      });

      // This should not throw
      const serviceA = await diConfigurator.resolve(NON_CIRCULAR_A);
      assert.deepEqual(serviceA, { name: "service-a" });
    });

    it("should handle parallel requests without false circular dependency detection", async () => {
      const PARALLEL_TOKEN = "PARALLEL_TOKEN";
      let counter = 0;

      diConfigurator.addSingleton(PARALLEL_TOKEN, async () => {
        counter++;
        // Simulate some async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { name: `parallel-service-${counter}` };
      });

      // Request the same service in parallel
      const [result1, result2, result3] = await Promise.all([
        diConfigurator.resolve(PARALLEL_TOKEN),
        diConfigurator.resolve(PARALLEL_TOKEN),
        diConfigurator.resolve(PARALLEL_TOKEN),
      ]);

      // Should be the same instance, created only once
      assert.strictEqual(result1, result2);
      assert.strictEqual(result2, result3);
      assert.equal(counter, 1, "Service factory should be called only once");
    });
  });

  describe("disposeSingletons", () => {
    it("should call onDispose for singleton services that implement IOnDispose", async () => {
      let onDisposeCallCount = 0;
      const DISPOSABLE_SINGLETON = "DISPOSABLE_SINGLETON";

      diConfigurator.addSingleton(DISPOSABLE_SINGLETON, async () => {
        const service: IOnDispose = {
          onDispose() {
            onDisposeCallCount++;
          },
        };
        return service;
      });

      // Resolve the service to create the instance
      await diConfigurator.resolve(DISPOSABLE_SINGLETON);
      assert.equal(onDisposeCallCount, 0, "onDispose should not be called yet");

      // Call disposeSingletons
      await diConfigurator.disposeSingletons();
      assert.equal(onDisposeCallCount, 1, "onDispose should be called once");
    });

    it("should reset instance and isResolved after disposing singleton services", async () => {
      let onDisposeCallCount = 0;
      const DISPOSABLE_SINGLETON = "DISPOSABLE_SINGLETON";

      diConfigurator.addSingleton(DISPOSABLE_SINGLETON, async () => {
        const service: IOnDispose = {
          onDispose() {
            onDisposeCallCount++;
          },
        };
        return service;
      });

      // Resolve the service to create the instance
      const firstInstance = await diConfigurator.resolve(DISPOSABLE_SINGLETON);

      // Call disposeSingletons
      await diConfigurator.disposeSingletons();
      assert.equal(onDisposeCallCount, 1);

      // Resolve again - should create a new instance
      const secondInstance = await diConfigurator.resolve(DISPOSABLE_SINGLETON);
      assert.notStrictEqual(
        firstInstance,
        secondInstance,
        "Should create new instance after disposal"
      );
      assert.equal(
        onDisposeCallCount,
        1,
        "onDispose should only be called once from disposal"
      );
    });

    it("should handle multiple singleton services with different tags", async () => {
      let primaryDisposeCount = 0;
      let secondaryDisposeCount = 0;
      const TAGGED_DISPOSABLE = "TAGGED_DISPOSABLE";

      diConfigurator.addSingleton(
        TAGGED_DISPOSABLE,
        async () => ({
          onDispose() {
            primaryDisposeCount++;
          },
        }),
        undefined,
        "primary"
      );

      diConfigurator.addSingleton(
        TAGGED_DISPOSABLE,
        async () => ({
          onDispose() {
            secondaryDisposeCount++;
          },
        }),
        undefined,
        "secondary"
      );

      // Resolve both services
      await diConfigurator.resolve(TAGGED_DISPOSABLE, "primary");
      await diConfigurator.resolve(TAGGED_DISPOSABLE, "secondary");

      // Call disposeSingletons
      await diConfigurator.disposeSingletons();

      assert.equal(
        primaryDisposeCount,
        1,
        "Primary service onDispose should be called"
      );
      assert.equal(
        secondaryDisposeCount,
        1,
        "Secondary service onDispose should be called"
      );
    });

    it("should not call onDispose for services that don't implement IOnDispose", async () => {
      const NON_DISPOSABLE_SINGLETON = "NON_DISPOSABLE_SINGLETON";
      let factoryCallCount = 0;

      diConfigurator.addSingleton(NON_DISPOSABLE_SINGLETON, async () => {
        factoryCallCount++;
        return { name: "non-disposable-service" };
      });

      // Resolve the service
      const firstInstance = await diConfigurator.resolve(
        NON_DISPOSABLE_SINGLETON
      );
      assert.equal(factoryCallCount, 1);

      // Call disposeSingletons - should not throw
      await diConfigurator.disposeSingletons();

      // All singleton services should be cleared/reset, even if they don't implement IOnDispose
      // but onDispose should not be called for services that don't implement it
      const secondInstance = await diConfigurator.resolve(
        NON_DISPOSABLE_SINGLETON
      );
      assert.notStrictEqual(
        firstInstance,
        secondInstance,
        "Should return new instance after disposal"
      );
      assert.equal(
        factoryCallCount,
        2,
        "Factory should be called again since service was disposed"
      );
    });

    it("should handle eager singleton services properly", async () => {
      let onDisposeCallCount = 0;
      let onConstructCallCount = 0;
      const EAGER_DISPOSABLE = "EAGER_DISPOSABLE";

      // Dispose current container first
      await diContainer.dispose();

      // Create new configurator
      diConfigurator = new DiConfigurator();

      diConfigurator.addSingleton(
        EAGER_DISPOSABLE,
        async () => {
          const service: IOnConstruct & IOnDispose = {
            onConstruct() {
              onConstructCallCount++;
            },
            onDispose() {
              onDisposeCallCount++;
            },
          };
          return service;
        },
        { eager: true }
      );

      // Build container - should trigger eager initialization
      diContainer = await diConfigurator.build();
      assert.equal(
        onConstructCallCount,
        1,
        "onConstruct should be called during build"
      );

      // Call disposeSingletons
      await diConfigurator.disposeSingletons();
      assert.equal(onDisposeCallCount, 1, "onDispose should be called");
    });

    it("should handle async onDispose methods", async () => {
      let asyncDisposeCompleted = false;
      const ASYNC_DISPOSABLE = "ASYNC_DISPOSABLE";

      diConfigurator.addSingleton(ASYNC_DISPOSABLE, async () => {
        const service: IOnDispose = {
          async onDispose() {
            // Simulate async disposal work
            await new Promise((resolve) => setTimeout(resolve, 10));
            asyncDisposeCompleted = true;
          },
        };
        return service;
      });

      // Resolve the service
      await diConfigurator.resolve(ASYNC_DISPOSABLE);

      // Call disposeSingletons
      await diConfigurator.disposeSingletons();

      assert.equal(
        asyncDisposeCompleted,
        true,
        "Async onDispose should complete"
      );
    });

    it("should dispose multiple singleton services concurrently", async () => {
      const disposalOrder: number[] = [];
      const DISPOSABLE_1 = "DISPOSABLE_1";
      const DISPOSABLE_2 = "DISPOSABLE_2";

      diConfigurator.addSingleton(DISPOSABLE_1, async () => ({
        async onDispose() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          disposalOrder.push(1);
        },
      }));

      diConfigurator.addSingleton(DISPOSABLE_2, async () => ({
        async onDispose() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          disposalOrder.push(2);
        },
      }));

      // Resolve both services
      await diConfigurator.resolve(DISPOSABLE_1);
      await diConfigurator.resolve(DISPOSABLE_2);

      const startTime = Date.now();
      await diConfigurator.disposeSingletons();
      const endTime = Date.now();

      // Should complete in roughly 20ms (concurrent), not 30ms (sequential)
      assert.ok(endTime - startTime < 30, "Should dispose concurrently");
      assert.equal(disposalOrder.length, 2, "Both services should be disposed");
      // Service 2 should finish first due to shorter delay
      assert.equal(disposalOrder[0], 2);
      assert.equal(disposalOrder[1], 1);
    });

    it("should only dispose singleton services that have been resolved", async () => {
      let unresolvedDisposeCount = 0;
      let resolvedDisposeCount = 0;
      const UNRESOLVED_SINGLETON = "UNRESOLVED_SINGLETON";
      const RESOLVED_SINGLETON = "RESOLVED_SINGLETON";

      diConfigurator.addSingleton(UNRESOLVED_SINGLETON, async () => ({
        onDispose() {
          unresolvedDisposeCount++;
        },
      }));

      diConfigurator.addSingleton(RESOLVED_SINGLETON, async () => ({
        onDispose() {
          resolvedDisposeCount++;
        },
      }));

      // Only resolve one service
      await diConfigurator.resolve(RESOLVED_SINGLETON);

      // Call disposeSingletons
      await diConfigurator.disposeSingletons();

      assert.equal(
        unresolvedDisposeCount,
        0,
        "Unresolved service should not be disposed"
      );
      assert.equal(
        resolvedDisposeCount,
        1,
        "Resolved service should be disposed"
      );
    });
  });

  describe("disposeScopedServices", () => {
    it("should return early when not in request scope context", async () => {
      assert.equal(diConfigurator.isInRequestScopeContext(), false);

      await diConfigurator.disposeScopedServices();

      assert.equal(diConfigurator.isInRequestScopeContext(), false);
    });

    it("should call onDispose for scoped services that implement IOnDispose", async () => {
      let onDisposeCallCount = 0;
      const DISPOSABLE_SCOPED = "DISPOSABLE_SCOPED";

      diConfigurator.addScoped(DISPOSABLE_SCOPED, async () => {
        const service: IOnDispose = {
          onDispose() {
            onDisposeCallCount++;
          },
        };
        return service;
      });

      await runScope(async () => {
        await diConfigurator.resolve(DISPOSABLE_SCOPED);
        assert.equal(
          onDisposeCallCount,
          0,
          "onDispose should not be called yet"
        );

        await diConfigurator.disposeScopedServices();
        assert.equal(onDisposeCallCount, 1, "onDispose should be called once");
      });
    });

    it("should clear service instances after disposal", async () => {
      let factoryCallCount = 0;
      const CLEARABLE_SCOPED = "CLEARABLE_SCOPED";

      diConfigurator.addScoped(CLEARABLE_SCOPED, async () => {
        factoryCallCount++;
        return { name: "clearable-service", id: factoryCallCount };
      });

      await runScope(async () => {
        const firstInstance = await diConfigurator.resolve(CLEARABLE_SCOPED);
        assert.equal(factoryCallCount, 1);
        assert.deepEqual(firstInstance, { name: "clearable-service", id: 1 });

        await diConfigurator.disposeScopedServices();

        const secondInstance = await diConfigurator.resolve(CLEARABLE_SCOPED);
        assert.equal(factoryCallCount, 2, "Factory should be called again");
        assert.deepEqual(secondInstance, { name: "clearable-service", id: 2 });
        assert.notStrictEqual(
          firstInstance,
          secondInstance,
          "Should be different instances"
        );
      });
    });

    it("should dispose multiple scoped services", async () => {
      let service1DisposeCount = 0;
      let service2DisposeCount = 0;
      const SCOPED_SERVICE_1 = "SCOPED_SERVICE_1";
      const SCOPED_SERVICE_2 = "SCOPED_SERVICE_2";

      diConfigurator.addScoped(SCOPED_SERVICE_1, async () => ({
        name: "service-1",
        onDispose() {
          service1DisposeCount++;
        },
      }));

      diConfigurator.addScoped(SCOPED_SERVICE_2, async () => ({
        name: "service-2",
        onDispose() {
          service2DisposeCount++;
        },
      }));

      await runScope(async () => {
        await diConfigurator.resolve(SCOPED_SERVICE_1);
        await diConfigurator.resolve(SCOPED_SERVICE_2);

        await diConfigurator.disposeScopedServices();

        assert.equal(service1DisposeCount, 1, "Service 1 should be disposed");
        assert.equal(service2DisposeCount, 1, "Service 2 should be disposed");
      });
    });

    it("should dispose scoped services with different tags", async () => {
      let primaryDisposeCount = 0;
      let secondaryDisposeCount = 0;
      const TAGGED_SCOPED_DISPOSABLE = "TAGGED_SCOPED_DISPOSABLE";

      diConfigurator.addScoped(
        TAGGED_SCOPED_DISPOSABLE,
        async () => ({
          name: "primary-service",
          onDispose() {
            primaryDisposeCount++;
          },
        }),
        "primary"
      );

      diConfigurator.addScoped(
        TAGGED_SCOPED_DISPOSABLE,
        async () => ({
          name: "secondary-service",
          onDispose() {
            secondaryDisposeCount++;
          },
        }),
        "secondary"
      );

      await runScope(async () => {
        await diConfigurator.resolve(TAGGED_SCOPED_DISPOSABLE, "primary");
        await diConfigurator.resolve(TAGGED_SCOPED_DISPOSABLE, "secondary");

        await diConfigurator.disposeScopedServices();

        assert.equal(
          primaryDisposeCount,
          1,
          "Primary service should be disposed"
        );
        assert.equal(
          secondaryDisposeCount,
          1,
          "Secondary service should be disposed"
        );
      });
    });

    it("should handle services without IOnDispose interface", async () => {
      let factoryCallCount = 0;
      const NON_DISPOSABLE_SCOPED = "NON_DISPOSABLE_SCOPED";

      diConfigurator.addScoped(NON_DISPOSABLE_SCOPED, async () => {
        factoryCallCount++;
        return { name: "non-disposable-service" };
      });

      await runScope(async () => {
        const firstInstance = await diConfigurator.resolve(
          NON_DISPOSABLE_SCOPED
        );
        assert.equal(factoryCallCount, 1);

        await diConfigurator.disposeScopedServices();

        const secondInstance = await diConfigurator.resolve(
          NON_DISPOSABLE_SCOPED
        );
        assert.equal(factoryCallCount, 2, "Factory should be called again");
        assert.notStrictEqual(
          firstInstance,
          secondInstance,
          "Should return new instance"
        );
      });
    });

    it("should handle async onDispose methods", async () => {
      let asyncDisposeCompleted = false;
      const ASYNC_DISPOSABLE_SCOPED = "ASYNC_DISPOSABLE_SCOPED";

      diConfigurator.addScoped(ASYNC_DISPOSABLE_SCOPED, async () => {
        const service: IOnDispose = {
          async onDispose() {
            await new Promise((resolve) => setTimeout(resolve, 10));
            asyncDisposeCompleted = true;
          },
        };
        return service;
      });

      await runScope(async () => {
        await diConfigurator.resolve(ASYNC_DISPOSABLE_SCOPED);

        await diConfigurator.disposeScopedServices();

        assert.equal(
          asyncDisposeCompleted,
          true,
          "Async onDispose should complete"
        );
      });
    });

    it("should dispose multiple scoped services concurrently", async () => {
      const disposalOrder: number[] = [];
      const DISPOSABLE_SCOPED_1 = "DISPOSABLE_SCOPED_1";
      const DISPOSABLE_SCOPED_2 = "DISPOSABLE_SCOPED_2";

      diConfigurator.addScoped(DISPOSABLE_SCOPED_1, async () => ({
        name: "service-1",
        async onDispose() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          disposalOrder.push(1);
        },
      }));

      diConfigurator.addScoped(DISPOSABLE_SCOPED_2, async () => ({
        name: "service-2",
        async onDispose() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          disposalOrder.push(2);
        },
      }));

      await runScope(async () => {
        await diConfigurator.resolve(DISPOSABLE_SCOPED_1);
        await diConfigurator.resolve(DISPOSABLE_SCOPED_2);

        const startTime = Date.now();
        await diConfigurator.disposeScopedServices();
        const endTime = Date.now();

        assert.ok(endTime - startTime < 30, "Should dispose concurrently");
        assert.equal(
          disposalOrder.length,
          2,
          "Both services should be disposed"
        );
        assert.equal(disposalOrder[0], 2);
        assert.equal(disposalOrder[1], 1);
      });
    });

    it("should only dispose scoped services that have been resolved", async () => {
      let unresolvedDisposeCount = 0;
      let resolvedDisposeCount = 0;
      const UNRESOLVED_SCOPED = "UNRESOLVED_SCOPED";
      const RESOLVED_SCOPED = "RESOLVED_SCOPED";

      diConfigurator.addScoped(UNRESOLVED_SCOPED, async () => ({
        name: "unresolved-service",
        onDispose() {
          unresolvedDisposeCount++;
        },
      }));

      diConfigurator.addScoped(RESOLVED_SCOPED, async () => ({
        name: "resolved-service",
        onDispose() {
          resolvedDisposeCount++;
        },
      }));

      await runScope(async () => {
        await diConfigurator.resolve(RESOLVED_SCOPED);

        await diConfigurator.disposeScopedServices();

        assert.equal(
          unresolvedDisposeCount,
          0,
          "Unresolved service should not be disposed"
        );
        assert.equal(
          resolvedDisposeCount,
          1,
          "Resolved service should be disposed"
        );
      });
    });

    it("should handle mixed services with and without IOnDispose", async () => {
      let disposableCallCount = 0;
      let nonDisposableFactoryCount = 0;
      const DISPOSABLE_SCOPED = "DISPOSABLE_SCOPED";
      const NON_DISPOSABLE_SCOPED = "NON_DISPOSABLE_SCOPED";

      diConfigurator.addScoped(DISPOSABLE_SCOPED, async () => ({
        name: "disposable-service",
        onDispose() {
          disposableCallCount++;
        },
      }));

      diConfigurator.addScoped(NON_DISPOSABLE_SCOPED, async () => {
        nonDisposableFactoryCount++;
        return { name: "non-disposable-service" };
      });

      await runScope(async () => {
        await diConfigurator.resolve(DISPOSABLE_SCOPED);
        const firstNonDisposable = await diConfigurator.resolve(
          NON_DISPOSABLE_SCOPED
        );
        assert.equal(nonDisposableFactoryCount, 1);

        await diConfigurator.disposeScopedServices();

        assert.equal(
          disposableCallCount,
          1,
          "Disposable service should call onDispose"
        );

        const secondNonDisposable = await diConfigurator.resolve(
          NON_DISPOSABLE_SCOPED
        );
        assert.equal(
          nonDisposableFactoryCount,
          2,
          "Non-disposable service should be recreated"
        );
        assert.notStrictEqual(firstNonDisposable, secondNonDisposable);
      });
    });

    it("should be safe to call multiple times within the same scope", async () => {
      let disposeCallCount = 0;
      const MULTI_DISPOSE_SCOPED = "MULTI_DISPOSE_SCOPED";

      diConfigurator.addScoped(MULTI_DISPOSE_SCOPED, async () => ({
        name: "multi-dispose-service",
        onDispose() {
          disposeCallCount++;
        },
      }));

      await runScope(async () => {
        await diConfigurator.resolve(MULTI_DISPOSE_SCOPED);

        await diConfigurator.disposeScopedServices();
        assert.equal(disposeCallCount, 1, "First disposal should work");

        await diConfigurator.disposeScopedServices();
        assert.equal(
          disposeCallCount,
          1,
          "Second disposal should be safe (no additional calls)"
        );

        await diConfigurator.disposeScopedServices();
        assert.equal(
          disposeCallCount,
          1,
          "Third disposal should be safe (no additional calls)"
        );
      });
    });
  });
});

describe("DIContainer | Service Override", () => {
  const SINGLETON_TOKEN: TServiceToken = "SINGLETON_TOKEN";
  const SCOPED_TOKEN: TServiceToken = "SCOPED_TOKEN";
  const TRANSIENT_TOKEN: TServiceToken = "TRANSIENT_TOKEN";

  let diConfigurator: DiConfigurator;
  let diContainer: DiContainer;

  const runScope = async (callback: () => Promise<any>) => {
    return await diConfigurator.runWithNewRequestScope(
      new AsyncContextStore(),
      callback
    );
  };

  beforeEach(async () => {
    diConfigurator = new DiConfigurator();

    diContainer = await diConfigurator.build();
  });

  afterEach(async () => {
    await diContainer.dispose();
  });

  it("should use only the first registered implementation for singleton services", async () => {
    diConfigurator.addSingleton(SINGLETON_TOKEN, async () => {
      return { name: "first-singleton-service" };
    });

    diConfigurator.addSingleton(SINGLETON_TOKEN, async () => {
      return { name: "overridden-singleton-service" };
    });

    const instance = await diConfigurator.resolve(SINGLETON_TOKEN);
    assert.deepEqual(instance, { name: "first-singleton-service" });
  });

  it("should use only the first registered implementation for scoped services", async () => {
    diConfigurator.addScoped(SCOPED_TOKEN, async () => {
      return { name: "first-scoped-service" };
    });

    diConfigurator.addScoped(SCOPED_TOKEN, async () => {
      return { name: "overridden-scoped-service" };
    });

    await runScope(async () => {
      const instance = await diConfigurator.resolve(SCOPED_TOKEN);
      assert.deepEqual(instance, { name: "first-scoped-service" });
    });
  });

  it("should use only the first registered implementation for transient services", async () => {
    diConfigurator.addTransient(TRANSIENT_TOKEN, async () => {
      return { name: "first-transient-service" };
    });

    diConfigurator.addTransient(TRANSIENT_TOKEN, async () => {
      return { name: "overridden-transient-service" };
    });

    const instance = await diConfigurator.resolve(TRANSIENT_TOKEN);
    assert.deepEqual(instance, { name: "first-transient-service" });
  });
});

describe("DIContainer | Tag Functionality", () => {
  const TAGGED_SINGLETON_TOKEN: TServiceToken = "TAGGED_SINGLETON_TOKEN";
  const TAGGED_SCOPED_TOKEN: TServiceToken = "TAGGED_SCOPED_TOKEN";
  const TAGGED_TRANSIENT_TOKEN: TServiceToken = "TAGGED_TRANSIENT_TOKEN";

  let diConfigurator: DiConfigurator;
  let diContainer: DiContainer;

  const runScope = async (callback: () => Promise<any>) => {
    return await diConfigurator.runWithNewRequestScope(
      new AsyncContextStore(),
      callback
    );
  };

  beforeEach(async () => {
    diConfigurator = new DiConfigurator();
    diContainer = await diConfigurator.build();
  });

  afterEach(async () => {
    await diContainer.dispose();
  });

  describe("Singleton Services with Tags", () => {
    it("should register and resolve singleton services with different tags", async () => {
      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "primary-service", tag: "primary" }),
        undefined,
        "primary"
      );

      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "secondary-service", tag: "secondary" }),
        undefined,
        "secondary"
      );

      const primaryService = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "primary"
      );
      const secondaryService = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "secondary"
      );

      assert.deepEqual(primaryService, {
        name: "primary-service",
        tag: "primary",
      });
      assert.deepEqual(secondaryService, {
        name: "secondary-service",
        tag: "secondary",
      });
      assert.notStrictEqual(primaryService, secondaryService);
    });

    it("should return the same instance for multiple resolves with the same tag", async () => {
      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "tagged-service", id: Math.random() }),
        undefined,
        "test-tag"
      );

      const instance1 = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "test-tag"
      );
      const instance2 = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "test-tag"
      );

      assert.strictEqual(instance1, instance2);
    });

    it("should handle eager singleton services with tags", async () => {
      let eagerBuildCount = 0;

      // Dispose current container first
      await diContainer.dispose();

      // Create new configurator and register eager service
      diConfigurator = new DiConfigurator();

      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => {
          eagerBuildCount++;
          return { name: "eager-tagged-service" };
        },
        { eager: true },
        "eager-tag"
      );

      // Build container to trigger eager initialization
      diContainer = await diConfigurator.build();

      assert.equal(
        eagerBuildCount,
        1,
        "Eager singleton should be built during container build"
      );

      const instance = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "eager-tag"
      );
      assert.deepEqual(instance, { name: "eager-tagged-service" });
      assert.equal(eagerBuildCount, 1, "Should not build again on resolve");
    });
  });

  describe("Scoped Services with Tags", () => {
    it("should register and resolve scoped services with different tags", async () => {
      diConfigurator.addScoped(
        TAGGED_SCOPED_TOKEN,
        async () => ({ name: "scoped-primary", tag: "primary" }),
        "primary"
      );

      diConfigurator.addScoped(
        TAGGED_SCOPED_TOKEN,
        async () => ({ name: "scoped-secondary", tag: "secondary" }),
        "secondary"
      );

      await runScope(async () => {
        const primaryService = await diConfigurator.resolve(
          TAGGED_SCOPED_TOKEN,
          "primary"
        );
        const secondaryService = await diConfigurator.resolve(
          TAGGED_SCOPED_TOKEN,
          "secondary"
        );

        assert.deepEqual(primaryService, {
          name: "scoped-primary",
          tag: "primary",
        });
        assert.deepEqual(secondaryService, {
          name: "scoped-secondary",
          tag: "secondary",
        });
        assert.notStrictEqual(primaryService, secondaryService);
      });
    });

    it("should return the same instance within a scope for the same tag", async () => {
      diConfigurator.addScoped(
        TAGGED_SCOPED_TOKEN,
        async () => ({ name: "scoped-service", id: Math.random() }),
        "scope-tag"
      );

      await runScope(async () => {
        const instance1 = await diConfigurator.resolve(
          TAGGED_SCOPED_TOKEN,
          "scope-tag"
        );
        const instance2 = await diConfigurator.resolve(
          TAGGED_SCOPED_TOKEN,
          "scope-tag"
        );

        assert.strictEqual(instance1, instance2);
      });
    });

    it("should create different instances in different scopes for the same tag", async () => {
      diConfigurator.addScoped(
        TAGGED_SCOPED_TOKEN,
        async () => ({ name: "scoped-service", id: Math.random() }),
        "scope-tag"
      );

      let firstScopeInstance: any;
      await runScope(async () => {
        firstScopeInstance = await diConfigurator.resolve(
          TAGGED_SCOPED_TOKEN,
          "scope-tag"
        );
      });

      let secondScopeInstance: any;
      await runScope(async () => {
        secondScopeInstance = await diConfigurator.resolve(
          TAGGED_SCOPED_TOKEN,
          "scope-tag"
        );
      });

      assert.notStrictEqual(firstScopeInstance, secondScopeInstance);
      assert.equal(firstScopeInstance.name, secondScopeInstance.name);
    });
  });

  describe("Transient Services with Tags", () => {
    it("should register and resolve transient services with different tags", async () => {
      diConfigurator.addTransient(
        TAGGED_TRANSIENT_TOKEN,
        async () => ({ name: "transient-primary", tag: "primary" }),
        "primary"
      );

      diConfigurator.addTransient(
        TAGGED_TRANSIENT_TOKEN,
        async () => ({ name: "transient-secondary", tag: "secondary" }),
        "secondary"
      );

      const primaryService1 = await diConfigurator.resolve(
        TAGGED_TRANSIENT_TOKEN,
        "primary"
      );
      const primaryService2 = await diConfigurator.resolve(
        TAGGED_TRANSIENT_TOKEN,
        "primary"
      );
      const secondaryService = await diConfigurator.resolve(
        TAGGED_TRANSIENT_TOKEN,
        "secondary"
      );

      assert.deepEqual(primaryService1, {
        name: "transient-primary",
        tag: "primary",
      });
      assert.deepEqual(primaryService2, {
        name: "transient-primary",
        tag: "primary",
      });
      assert.deepEqual(secondaryService, {
        name: "transient-secondary",
        tag: "secondary",
      });

      // All instances should be different (transient behavior)
      assert.notStrictEqual(primaryService1, primaryService2);
      assert.notStrictEqual(primaryService1, secondaryService);
    });

    it("should create new instances for each resolve even with the same tag", async () => {
      diConfigurator.addTransient(
        TAGGED_TRANSIENT_TOKEN,
        async () => ({ name: "transient-service", id: Math.random() }),
        "transient-tag"
      );

      const instance1 = await diConfigurator.resolve(
        TAGGED_TRANSIENT_TOKEN,
        "transient-tag"
      );
      const instance2 = await diConfigurator.resolve(
        TAGGED_TRANSIENT_TOKEN,
        "transient-tag"
      );

      assert.notStrictEqual(instance1, instance2);
      assert.equal((instance1 as any).name, (instance2 as any).name);
      assert.notEqual((instance1 as any).id, (instance2 as any).id);
    });
  });

  describe("Tag Normalization", () => {
    it("should treat tags as case-insensitive", async () => {
      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "case-insensitive-service" }),
        undefined,
        "MyTag"
      );

      const service1 = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "MyTag"
      );
      const service2 = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "mytag"
      );
      const service3 = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "MYTAG"
      );

      assert.strictEqual(service1, service2);
      assert.strictEqual(service2, service3);
      assert.deepEqual(service1, { name: "case-insensitive-service" });
    });

    it("should normalize empty/undefined tags to 'default'", async () => {
      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "default-tag-service" })
        // No tag parameter - should use "default"
      );

      const service1 = await diConfigurator.resolve(TAGGED_SINGLETON_TOKEN); // No tag
      const service2 = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "default"
      );
      const service3 = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "DEFAULT"
      );

      assert.strictEqual(service1, service2);
      assert.strictEqual(service2, service3);
      assert.deepEqual(service1, { name: "default-tag-service" });
    });
  });

  describe("Default Tag Behavior", () => {
    it("should resolve services without tags using default tag", async () => {
      diConfigurator.addSingleton(TAGGED_SINGLETON_TOKEN, async () => ({
        name: "no-tag-service",
      }));

      const service = await diConfigurator.resolve(TAGGED_SINGLETON_TOKEN);
      assert.deepEqual(service, { name: "no-tag-service" });
    });

    it("should not conflict between explicit 'default' tag and no tag", async () => {
      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "explicit-default-service" }),
        undefined,
        "default"
      );

      // This should not register because "default" tag already exists
      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "implicit-default-service" })
        // No tag - should normalize to "default"
      );

      const service = await diConfigurator.resolve(TAGGED_SINGLETON_TOKEN);
      // Should get the first registered service (explicit default)
      assert.deepEqual(service, { name: "explicit-default-service" });
    });
  });

  describe("Service Override Prevention with Tags", () => {
    it("should not override existing service registration with same token and tag", async () => {
      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "first-service" }),
        undefined,
        "same-tag"
      );

      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "second-service" }),
        undefined,
        "same-tag"
      );

      const service = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "same-tag"
      );
      assert.deepEqual(service, { name: "first-service" });
    });

    it("should allow different services with same token but different tags", async () => {
      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "tag1-service" }),
        undefined,
        "tag1"
      );

      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "tag2-service" }),
        undefined,
        "tag2"
      );

      const service1 = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "tag1"
      );
      const service2 = await diConfigurator.resolve(
        TAGGED_SINGLETON_TOKEN,
        "tag2"
      );

      assert.deepEqual(service1, { name: "tag1-service" });
      assert.deepEqual(service2, { name: "tag2-service" });
      assert.notStrictEqual(service1, service2);
    });
  });

  describe("Error Handling with Tags", () => {
    it("should throw UnregisteredDependencyError when resolving non-existent tag", async () => {
      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => ({ name: "existing-service" }),
        undefined,
        "existing-tag"
      );

      await assert.rejects(
        diConfigurator.resolve(TAGGED_SINGLETON_TOKEN, "non-existent-tag"),
        /Service for token .* is not registered/
      );
    });

    it("should throw RequestScopeResolutionError for scoped services with tags outside scope", async () => {
      diConfigurator.addScoped(
        TAGGED_SCOPED_TOKEN,
        async () => ({ name: "scoped-service" }),
        "scoped-tag"
      );

      await assert.rejects(
        diConfigurator.resolve(TAGGED_SCOPED_TOKEN, "scoped-tag"),
        /Cannot resolve request-scoped service/
      );
    });
  });

  describe("Lifecycle Hooks with Tags", () => {
    it("should call lifecycle hooks for tagged singleton services", async () => {
      let constructCount = 0;
      let disposeCount = 0;

      diConfigurator.addSingleton(
        TAGGED_SINGLETON_TOKEN,
        async () => {
          const service: IOnConstruct & IOnDispose & { name: string } = {
            name: "tagged-hooked-service",
            onConstruct() {
              constructCount++;
            },
            onDispose() {
              disposeCount++;
            },
          };
          return service;
        },
        undefined,
        "hooked-tag"
      );

      await diConfigurator.resolve(TAGGED_SINGLETON_TOKEN, "hooked-tag");
      assert.equal(constructCount, 1);

      await diConfigurator.dispose();
      assert.equal(disposeCount, 1);
    });

    it("should call lifecycle hooks for tagged scoped services", async () => {
      let constructCount = 0;
      let disposeCount = 0;

      diConfigurator.addScoped(
        TAGGED_SCOPED_TOKEN,
        async () => {
          const service: IOnConstruct & IOnDispose & { name: string } = {
            name: "tagged-scoped-hooked-service",
            onConstruct() {
              constructCount++;
            },
            onDispose() {
              disposeCount++;
            },
          };
          return service;
        },
        "scoped-hooked-tag"
      );

      await runScope(async () => {
        await diConfigurator.resolve(TAGGED_SCOPED_TOKEN, "scoped-hooked-tag");
        assert.equal(constructCount, 1);
      });

      // After scope ends, dispose should be called
      assert.equal(disposeCount, 1);
    });
  });
});
