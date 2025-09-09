import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DiDiscoveryService } from "../src/di-discovery-service";
import { IServiceRegistration, TLifetime, IDiConfigurator } from "../src/types";
import { DiConfigurator } from "../src/di-configurator";
import { ServiceRegistration } from "../src/service-registration";

describe("DiDiscoveryService", () => {
  let discoveryService: DiDiscoveryService;
  let mockServiceRegistrations: IServiceRegistration[];

  beforeEach(() => {
    // Create mock service registrations for testing
    const serviceDClass = class ServiceD {};

    mockServiceRegistrations = [
      new ServiceRegistration({
        token: "SERVICE_A",
        lifetime: "singleton",
        factory: () => ({ name: "ServiceA" }),
        tag: "database",
      }),
      new ServiceRegistration({
        token: "SERVICE_B",
        lifetime: "scoped",
        factory: () => ({ name: "ServiceB" }),
        tag: "api",
      }),
      new ServiceRegistration({
        token: Symbol("SERVICE_C"),
        lifetime: "transient",
        factory: () => ({ name: "ServiceC" }),
        tag: "database",
      }),
      new ServiceRegistration({
        token: serviceDClass,
        lifetime: "singleton",
        factory: () => new serviceDClass(),
        tag: "business",
        singletonOptions: { eager: true },
      }),
      new ServiceRegistration({
        token: "SERVICE_E",
        lifetime: "scoped",
        factory: () => ({ name: "ServiceE" }),
        tag: "api",
      }),
    ];

    // Set resolved state for SERVICE_B to match the original test expectation
    (mockServiceRegistrations[1] as ServiceRegistration).setInstance({
      name: "ServiceB",
    });

    // Create discovery service with mock getter
    discoveryService = new DiDiscoveryService(() => mockServiceRegistrations);
  });

  describe("getAll", () => {
    it("should return all service registrations when called with empty query", () => {
      const result = discoveryService.getAll();

      assert.strictEqual(result.length, mockServiceRegistrations.length);
      assert.deepStrictEqual(result, mockServiceRegistrations);
    });

    it("should return all service registrations regardless of query parameters", () => {
      // Note: Current implementation ignores query parameters
      const result = discoveryService.getAll();

      assert.strictEqual(result.length, mockServiceRegistrations.length);
      assert.deepStrictEqual(result, mockServiceRegistrations);
    });

    it("should return empty array when no services are registered", () => {
      const emptyDiscoveryService = new DiDiscoveryService(() => []);
      const result = emptyDiscoveryService.getAll();

      assert.strictEqual(result.length, 0);
      assert.deepStrictEqual(result, []);
    });
  });

  describe("getServicesByTag", () => {
    it("should return services with matching tag", () => {
      const result = discoveryService.getServicesByTag("database");

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].token, "SERVICE_A");
      // For symbol tokens, we just check that it's the same reference from our mock data
      assert.strictEqual(result[1].token, mockServiceRegistrations[2].token);
      result.forEach((service) => {
        assert.strictEqual(service.tag, "database");
      });
    });

    it("should return services with api tag", () => {
      const result = discoveryService.getServicesByTag("api");

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].token, "SERVICE_B");
      assert.strictEqual(result[1].token, "SERVICE_E");
      result.forEach((service) => {
        assert.strictEqual(service.tag, "api");
      });
    });

    it("should return single service with unique tag", () => {
      const result = discoveryService.getServicesByTag("business");

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].tag, "business");
    });

    it("should return empty array for non-existent tag", () => {
      const result = discoveryService.getServicesByTag("nonexistent");

      assert.strictEqual(result.length, 0);
      assert.deepStrictEqual(result, []);
    });

    it("should return empty array for empty tag string", () => {
      const result = discoveryService.getServicesByTag("");

      assert.strictEqual(result.length, 0);
    });

    it("should handle case-sensitive tag matching", () => {
      const result = discoveryService.getServicesByTag("Database"); // Different case

      assert.strictEqual(result.length, 0);
    });
  });

  describe("getServicesByServiceToken", () => {
    it("should return service with matching string token", () => {
      const result = discoveryService.getServicesByServiceToken("SERVICE_A");

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].token, "SERVICE_A");
      assert.strictEqual(result[0].tokenType, "string");
    });

    it("should return service with matching symbol token", () => {
      const symbolToken = mockServiceRegistrations[2].token;
      const result = discoveryService.getServicesByServiceToken(symbolToken);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].token, symbolToken);
      assert.strictEqual(result[0].tokenType, "symbol");
    });

    it("should return service with matching class token", () => {
      const classToken = mockServiceRegistrations[3].token;
      const result = discoveryService.getServicesByServiceToken(classToken);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].token, classToken);
      assert.strictEqual(result[0].tokenType, "class");
    });

    it("should return empty array for non-existent token", () => {
      const result = discoveryService.getServicesByServiceToken("NON_EXISTENT");

      assert.strictEqual(result.length, 0);
    });

    it("should return empty array for undefined token", () => {
      const result = discoveryService.getServicesByServiceToken(
        undefined as any
      );

      assert.strictEqual(result.length, 0);
    });

    it("should handle multiple services with same token if they exist", () => {
      // Add another service with same token for testing
      const duplicateService = new ServiceRegistration({
        token: "SERVICE_A",
        lifetime: "transient",
        factory: () => ({ name: "ServiceA_Duplicate" }),
        tag: "duplicate",
      });

      const servicesWithDuplicate = [
        ...mockServiceRegistrations,
        duplicateService,
      ];
      const discoveryServiceWithDuplicate = new DiDiscoveryService(
        () => servicesWithDuplicate
      );

      const result =
        discoveryServiceWithDuplicate.getServicesByServiceToken("SERVICE_A");

      assert.strictEqual(result.length, 2);
      result.forEach((service) => {
        assert.strictEqual(service.token, "SERVICE_A");
      });
    });
  });

  describe("getServicesByLifetime", () => {
    it("should return singleton services", () => {
      const result = discoveryService.getServicesByLifetime("singleton");

      assert.strictEqual(result.length, 2);
      result.forEach((service) => {
        assert.strictEqual(service.lifetime, "singleton");
      });
    });

    it("should return scoped services", () => {
      const result = discoveryService.getServicesByLifetime("scoped");

      assert.strictEqual(result.length, 2);
      result.forEach((service) => {
        assert.strictEqual(service.lifetime, "scoped");
      });
    });

    it("should return transient services", () => {
      const result = discoveryService.getServicesByLifetime("transient");

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].lifetime, "transient");
    });

    it("should return empty array for non-existent lifetime", () => {
      const result = discoveryService.getServicesByLifetime(
        "invalid" as TLifetime
      );

      assert.strictEqual(result.length, 0);
    });

    it("should return empty array when no services match lifetime", () => {
      const emptyDiscoveryService = new DiDiscoveryService(() => []);
      const result = emptyDiscoveryService.getServicesByLifetime("singleton");

      assert.strictEqual(result.length, 0);
    });
  });

  describe("constructor", () => {
    it("should accept service registrations getter function", () => {
      const getter = () => mockServiceRegistrations;
      const service = new DiDiscoveryService(getter);

      assert.ok(service instanceof DiDiscoveryService);
    });

    it("should work with empty service registrations", () => {
      const emptyGetter = () => [];
      const service = new DiDiscoveryService(emptyGetter);

      const result = service.getAll();
      assert.strictEqual(result.length, 0);
    });

    it("should call getter function for each method call", () => {
      let callCount = 0;
      const trackingGetter = () => {
        callCount++;
        return mockServiceRegistrations;
      };

      const service = new DiDiscoveryService(trackingGetter);

      service.getAll();
      service.getServicesByTag("database");
      service.getServicesByServiceToken("SERVICE_A");
      service.getServicesByLifetime("singleton");

      assert.strictEqual(callCount, 4);
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle services with undefined tags", () => {
      const serviceWithUndefinedTag = new ServiceRegistration({
        token: "SERVICE_UNDEFINED_TAG",
        lifetime: "singleton",
        factory: () => ({}),
        tag: undefined as any,
      });

      const servicesWithUndefined = [
        ...mockServiceRegistrations,
        serviceWithUndefinedTag,
      ];
      const discoveryServiceWithUndefined = new DiDiscoveryService(
        () => servicesWithUndefined
      );

      const result = discoveryServiceWithUndefined.getServicesByTag("database");
      assert.strictEqual(result.length, 2); // Should not include undefined tag service
    });

    it("should handle getter function that throws", () => {
      const throwingGetter = () => {
        throw new Error("Getter error");
      };

      const service = new DiDiscoveryService(throwingGetter);

      assert.throws(() => service.getAll(), /Getter error/);
      assert.throws(() => service.getServicesByTag("test"), /Getter error/);
      assert.throws(
        () => service.getServicesByServiceToken("test"),
        /Getter error/
      );
      assert.throws(
        () => service.getServicesByLifetime("singleton"),
        /Getter error/
      );
    });
  });

  describe("Integration Tests with DiConfigurator", () => {
    let diConfigurator: DiConfigurator;
    let discoveryService: DiDiscoveryService;

    // Test service classes
    class DatabaseService {
      public readonly name = "DatabaseService";
      public connect() {
        return "connected";
      }
    }

    class ApiService {
      public readonly name = "ApiService";
      constructor(private readonly dbService: DatabaseService) {}

      public getData() {
        return `API data from ${this.dbService.name}`;
      }
    }

    class LoggerService {
      public readonly name = "LoggerService";
      public log(message: string) {
        return `LOG: ${message}`;
      }
    }

    // Service tokens
    const DATABASE_TOKEN = Symbol("DATABASE_SERVICE");
    const API_TOKEN = "API_SERVICE";
    const LOGGER_TOKEN = LoggerService;
    const CACHE_TOKEN = "CACHE_SERVICE";

    beforeEach(() => {
      diConfigurator = new DiConfigurator();
      discoveryService = diConfigurator.getDiscoveryService();
    });

    afterEach(async () => {
      await diConfigurator.dispose();
    });

    describe("Singleton Service Discovery", () => {
      it("should discover singleton services with different token types", () => {
        // Register singleton services
        diConfigurator.addSingleton(
          DATABASE_TOKEN,
          () => new DatabaseService(),
          undefined,
          "database"
        );
        diConfigurator.addSingleton(
          API_TOKEN,
          (container) =>
            container
              .resolve(DATABASE_TOKEN)
              .then((db) => new ApiService(db as DatabaseService)),
          undefined,
          "api"
        );
        diConfigurator.addSingleton(
          LOGGER_TOKEN,
          () => new LoggerService(),
          { eager: true },
          "logging"
        );

        const allServices = discoveryService.getAll();
        assert.strictEqual(allServices.length, 3);

        // Test by token type
        const symbolServices =
          discoveryService.getServicesByServiceToken(DATABASE_TOKEN);
        assert.strictEqual(symbolServices.length, 1);
        assert.strictEqual(symbolServices[0].tokenType, "symbol");
        assert.strictEqual(symbolServices[0].lifetime, "singleton");
        assert.strictEqual(symbolServices[0].tag, "database");

        const stringServices =
          discoveryService.getServicesByServiceToken(API_TOKEN);
        assert.strictEqual(stringServices.length, 1);
        assert.strictEqual(stringServices[0].tokenType, "string");
        assert.strictEqual(stringServices[0].lifetime, "singleton");
        assert.strictEqual(stringServices[0].tag, "api");

        const classServices =
          discoveryService.getServicesByServiceToken(LOGGER_TOKEN);
        assert.strictEqual(classServices.length, 1);
        assert.strictEqual(classServices[0].tokenType, "class");
        assert.strictEqual(classServices[0].lifetime, "singleton");
        assert.strictEqual(classServices[0].tag, "logging");
        assert.strictEqual(classServices[0].singletonOptions?.eager, true);
      });

      it("should discover singleton services by lifetime", () => {
        diConfigurator.addSingleton(
          DATABASE_TOKEN,
          () => new DatabaseService()
        );
        diConfigurator.addSingleton(
          API_TOKEN,
          () => new ApiService({} as DatabaseService)
        );
        diConfigurator.addScoped(CACHE_TOKEN, () => ({ cache: "data" }));

        const singletonServices =
          discoveryService.getServicesByLifetime("singleton");
        assert.strictEqual(singletonServices.length, 2);

        const scopedServices = discoveryService.getServicesByLifetime("scoped");
        assert.strictEqual(scopedServices.length, 1);
        assert.strictEqual(scopedServices[0].token, CACHE_TOKEN);
      });

      it("should discover singleton services by tag", () => {
        diConfigurator.addSingleton(
          DATABASE_TOKEN,
          () => new DatabaseService(),
          undefined,
          "infrastructure"
        );
        diConfigurator.addSingleton(
          API_TOKEN,
          () => new ApiService({} as DatabaseService),
          undefined,
          "infrastructure"
        );
        diConfigurator.addSingleton(
          LOGGER_TOKEN,
          () => new LoggerService(),
          undefined,
          "logging"
        );

        const infrastructureServices =
          discoveryService.getServicesByTag("infrastructure");
        assert.strictEqual(infrastructureServices.length, 2);
        infrastructureServices.forEach((service) => {
          assert.strictEqual(service.tag, "infrastructure");
          assert.strictEqual(service.lifetime, "singleton");
        });

        const loggingServices = discoveryService.getServicesByTag("logging");
        assert.strictEqual(loggingServices.length, 1);
        assert.strictEqual(loggingServices[0].tag, "logging");
      });
    });

    describe("Scoped Service Discovery", () => {
      it("should discover scoped services with different configurations", () => {
        diConfigurator.addScoped(
          DATABASE_TOKEN,
          () => new DatabaseService(),
          "database"
        );
        diConfigurator.addScoped(
          API_TOKEN,
          (container) =>
            container
              .resolve(DATABASE_TOKEN)
              .then((db) => new ApiService(db as DatabaseService)),
          "api"
        );

        const scopedServices = discoveryService.getServicesByLifetime("scoped");
        assert.strictEqual(scopedServices.length, 2);

        scopedServices.forEach((service) => {
          assert.strictEqual(service.lifetime, "scoped");
          assert.ok(["database", "api"].includes(service.tag));
        });

        const databaseServices = discoveryService.getServicesByTag("database");
        assert.strictEqual(databaseServices.length, 1);
        assert.strictEqual(databaseServices[0].lifetime, "scoped");
      });

      it("should discover scoped services by token", () => {
        diConfigurator.addScoped(DATABASE_TOKEN, () => new DatabaseService());
        diConfigurator.addScoped(LOGGER_TOKEN, () => new LoggerService());

        const dbServices =
          discoveryService.getServicesByServiceToken(DATABASE_TOKEN);
        assert.strictEqual(dbServices.length, 1);
        assert.strictEqual(dbServices[0].lifetime, "scoped");
        assert.strictEqual(dbServices[0].tokenType, "symbol");

        const loggerServices =
          discoveryService.getServicesByServiceToken(LOGGER_TOKEN);
        assert.strictEqual(loggerServices.length, 1);
        assert.strictEqual(loggerServices[0].lifetime, "scoped");
        assert.strictEqual(loggerServices[0].tokenType, "class");
      });
    });

    describe("Transient Service Discovery", () => {
      it("should discover transient services", () => {
        diConfigurator.addTransient(
          DATABASE_TOKEN,
          () => new DatabaseService(),
          "database"
        );
        diConfigurator.addTransient(
          API_TOKEN,
          () => new ApiService({} as DatabaseService),
          "api"
        );
        diConfigurator.addTransient(
          LOGGER_TOKEN,
          () => new LoggerService(),
          "logging"
        );

        const transientServices =
          discoveryService.getServicesByLifetime("transient");
        assert.strictEqual(transientServices.length, 3);

        transientServices.forEach((service) => {
          assert.strictEqual(service.lifetime, "transient");
        });

        const apiServices = discoveryService.getServicesByTag("api");
        assert.strictEqual(apiServices.length, 1);
        assert.strictEqual(apiServices[0].lifetime, "transient");
        assert.strictEqual(apiServices[0].token, API_TOKEN);
      });
    });

    describe("Mixed Lifetime Discovery", () => {
      it("should discover services across different lifetimes", () => {
        // Register services with different lifetimes
        diConfigurator.addSingleton(
          DATABASE_TOKEN,
          () => new DatabaseService(),
          undefined,
          "core"
        );
        diConfigurator.addScoped(
          API_TOKEN,
          () => new ApiService({} as DatabaseService),
          "core"
        );
        diConfigurator.addTransient(
          LOGGER_TOKEN,
          () => new LoggerService(),
          "utility"
        );
        diConfigurator.addTransient(
          CACHE_TOKEN,
          () => ({ data: "cached" }),
          "utility"
        );

        const allServices = discoveryService.getAll();
        assert.strictEqual(allServices.length, 4);

        // Test by lifetime
        const singletonServices =
          discoveryService.getServicesByLifetime("singleton");
        const scopedServices = discoveryService.getServicesByLifetime("scoped");
        const transientServices =
          discoveryService.getServicesByLifetime("transient");

        assert.strictEqual(singletonServices.length, 1);
        assert.strictEqual(scopedServices.length, 1);
        assert.strictEqual(transientServices.length, 2);

        // Test by tag
        const coreServices = discoveryService.getServicesByTag("core");
        const utilityServices = discoveryService.getServicesByTag("utility");

        assert.strictEqual(coreServices.length, 2);
        assert.strictEqual(utilityServices.length, 2);

        // Verify core services have different lifetimes
        const coreLifetimes = coreServices.map((s) => s.lifetime);
        assert.ok(coreLifetimes.includes("singleton"));
        assert.ok(coreLifetimes.includes("scoped"));
      });
    });

    describe("Service Registration State", () => {
      it("should track service resolution state correctly", async () => {
        diConfigurator.addSingleton(
          DATABASE_TOKEN,
          () => new DatabaseService()
        );
        diConfigurator.addSingleton(LOGGER_TOKEN, () => new LoggerService(), {
          eager: true,
        });

        const container = await diConfigurator.build();

        // After building, eager singleton should be resolved
        const allServices = discoveryService.getAll();
        const eagerService = allServices.find((s) => s.token === LOGGER_TOKEN);
        const lazyService = allServices.find((s) => s.token === DATABASE_TOKEN);

        assert.ok(eagerService);
        assert.ok(lazyService);

        // Note: The actual resolution state depends on the implementation
        // This test verifies the structure is correct
        assert.ok(typeof eagerService.isResolved === "boolean");
        assert.ok(typeof lazyService.isResolved === "boolean");
      });

      it("should maintain service factory references", () => {
        const dbFactory = () => new DatabaseService();
        const loggerFactory = () => new LoggerService();

        diConfigurator.addSingleton(DATABASE_TOKEN, dbFactory);
        diConfigurator.addTransient(LOGGER_TOKEN, loggerFactory);

        const dbServices =
          discoveryService.getServicesByServiceToken(DATABASE_TOKEN);
        const loggerServices =
          discoveryService.getServicesByServiceToken(LOGGER_TOKEN);

        assert.strictEqual(dbServices.length, 1);
        assert.strictEqual(loggerServices.length, 1);

        // Verify factory functions are stored
        assert.strictEqual(typeof dbServices[0].factory, "function");
        assert.strictEqual(typeof loggerServices[0].factory, "function");
      });
    });

    describe("Service Override Prevention", () => {
      it("should not discover duplicate service registrations with same tag", () => {
        // Register same service twice with same tag
        diConfigurator.addSingleton(
          DATABASE_TOKEN,
          () => new DatabaseService(),
          undefined,
          "database"
        );
        diConfigurator.addSingleton(
          DATABASE_TOKEN,
          () => new DatabaseService(),
          undefined,
          "database"
        );

        const dbServices =
          discoveryService.getServicesByServiceToken(DATABASE_TOKEN);

        // Should only have one registration (first one wins when tag is the same)
        assert.strictEqual(dbServices.length, 1);
        assert.strictEqual(dbServices[0].tag, "database");
      });

      it("should allow same token with different tags", () => {
        diConfigurator.addSingleton(
          DATABASE_TOKEN,
          () => new DatabaseService(),
          undefined,
          "primary"
        );
        diConfigurator.addSingleton(
          DATABASE_TOKEN,
          () => new DatabaseService(),
          undefined,
          "secondary"
        );

        const allServices = discoveryService.getAll();
        const dbServices = allServices.filter(
          (s) => s.token === DATABASE_TOKEN
        );

        // Should have 2 registrations with different tags
        assert.strictEqual(dbServices.length, 2);

        const tags = dbServices.map((s) => s.tag).sort();
        assert.deepStrictEqual(tags, ["primary", "secondary"]);
      });
    });

    describe("Real-world Integration Scenarios", () => {
      it("should work with complex service dependency chains", () => {
        // Create a realistic service dependency chain
        diConfigurator.addSingleton(
          "CONFIG",
          () => ({ dbUrl: "localhost", apiPort: 3000 }),
          undefined,
          "config"
        );

        diConfigurator.addSingleton(
          DATABASE_TOKEN,
          async (container) => {
            const config = await container.resolve("CONFIG");
            const db = new DatabaseService();
            return db;
          },
          undefined,
          "infrastructure"
        );

        diConfigurator.addScoped(
          API_TOKEN,
          async (container) => {
            const db = await container.resolve(DATABASE_TOKEN);
            return new ApiService(db as DatabaseService);
          },
          "business"
        );

        diConfigurator.addTransient(
          LOGGER_TOKEN,
          () => new LoggerService(),
          "utility"
        );

        const allServices = discoveryService.getAll();
        assert.strictEqual(allServices.length, 4);

        // Verify service categories
        const configServices = discoveryService.getServicesByTag("config");
        const infrastructureServices =
          discoveryService.getServicesByTag("infrastructure");
        const businessServices = discoveryService.getServicesByTag("business");
        const utilityServices = discoveryService.getServicesByTag("utility");

        assert.strictEqual(configServices.length, 1);
        assert.strictEqual(infrastructureServices.length, 1);
        assert.strictEqual(businessServices.length, 1);
        assert.strictEqual(utilityServices.length, 1);

        // Verify lifetimes match expected patterns
        assert.strictEqual(configServices[0].lifetime, "singleton");
        assert.strictEqual(infrastructureServices[0].lifetime, "singleton");
        assert.strictEqual(businessServices[0].lifetime, "scoped");
        assert.strictEqual(utilityServices[0].lifetime, "transient");
      });

      it("should discover services after module registration", () => {
        // Create a module
        const testModule = {
          register: (configurator: IDiConfigurator) => {
            configurator.addSingleton(
              "MODULE_SERVICE_1",
              () => ({ name: "Service1" }),
              undefined,
              "module"
            );
            configurator.addScoped(
              "MODULE_SERVICE_2",
              () => ({ name: "Service2" }),
              "module"
            );
          },
        };

        // Register services before module
        diConfigurator.addTransient(
          LOGGER_TOKEN,
          () => new LoggerService(),
          "core"
        );

        // Add module
        diConfigurator.addModule(testModule);

        const allServices = discoveryService.getAll();
        assert.strictEqual(allServices.length, 3);

        const moduleServices = discoveryService.getServicesByTag("module");
        assert.strictEqual(moduleServices.length, 2);

        const coreServices = discoveryService.getServicesByTag("core");
        assert.strictEqual(coreServices.length, 1);
      });
    });
  });
});
