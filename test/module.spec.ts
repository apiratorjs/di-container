import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DiConfigurator, DiModule, IDiModule } from "../src";
import { AsyncContextStore } from "@apiratorjs/async-context";

describe("Module", () => {
  let configurator: DiConfigurator;

  beforeEach(() => {
    configurator = new DiConfigurator();
  });

  describe("Basic Module Registration", () => {
    it("should register providers from a module", async () => {
      const TEST_TOKEN = Symbol("TEST_TOKEN");
      const testValue = "test-value";

      const testModule = DiModule.create({
        providers: [
          {
            token: TEST_TOKEN,
            useFactory: () => testValue,
            lifetime: "singleton"
          }
        ]
      });

      configurator.addModule(testModule);

      const container = await configurator.build();
      const result = await container.resolve(TEST_TOKEN);

      assert.equal(result, testValue);
    });

    it("should register class-based providers with correct lifetime", async () => {
      class TestService {
        getValue() {
          return "test-service-value";
        }
      }

      const SINGLETON_TOKEN = Symbol("SINGLETON");
      const SCOPED_TOKEN = Symbol("SCOPED");
      const TRANSIENT_TOKEN = Symbol("TRANSIENT");

      const testModule = DiModule.create({
        providers: [
          {
            token: SINGLETON_TOKEN,
            useFactory: () => new TestService(),
            lifetime: "singleton"
          },
          {
            token: SCOPED_TOKEN,
            useFactory: () => new TestService(),
            lifetime: "scoped"
          },
          {
            token: TRANSIENT_TOKEN,
            useFactory: () => new TestService(),
            lifetime: "transient"
          }
        ]
      });

      configurator.addModule(testModule);
      const container = await configurator.build();

      const singleton1 = await container.resolve(SINGLETON_TOKEN);
      const singleton2 = await container.resolve(SINGLETON_TOKEN);
      assert.strictEqual(singleton1, singleton2);

      const transient1 = await container.resolve(TRANSIENT_TOKEN);
      const transient2 = await container.resolve(TRANSIENT_TOKEN);
      assert.notStrictEqual(transient1, transient2);

      await container.runWithNewRequestScope(
        new AsyncContextStore(),
        async (scopedContainer) => {
          const scoped1 = await scopedContainer.resolve(SCOPED_TOKEN);
          const scoped2 = await scopedContainer.resolve(SCOPED_TOKEN);
          assert.strictEqual(scoped1, scoped2);
        }
      );

      let instance1: any;
      await container.runWithNewRequestScope(
        new AsyncContextStore(),
        async (scope1) => {
          instance1 = await scope1.resolve(SCOPED_TOKEN);
        }
      );

      let instance2: any;
      await container.runWithNewRequestScope(
        new AsyncContextStore(),
        async (scope2) => {
          instance2 = await scope2.resolve(SCOPED_TOKEN);
        }
      );

      assert.notStrictEqual(instance1, instance2);
    });

    it("should register factory-based providers", async () => {
      let factoryCallCount = 0;
      const TEST_TOKEN = Symbol("TEST_TOKEN");
      const factoryFn = () => {
        factoryCallCount++;
        return "factory-result";
      };

      const testModule = DiModule.create({
        providers: [
          {
            token: TEST_TOKEN,
            useFactory: factoryFn,
            lifetime: "singleton"
          }
        ]
      });

      configurator.addModule(testModule);
      const container = await configurator.build();

      const result = await container.resolve(TEST_TOKEN);

      assert.equal(result, "factory-result");
      assert.equal(factoryCallCount, 1);
    });
  });

  describe("Module Composition", () => {
    it("should compose multiple modules", async () => {
      const TOKEN_A = Symbol("A");
      const TOKEN_B = Symbol("B");
      const TOKEN_C = Symbol("C");

      const moduleA = DiModule.create({
        providers: [
          {
            token: TOKEN_A,
            useFactory: () => "A",
            lifetime: "singleton"
          }
        ]
      });

      const moduleB = DiModule.create({
        providers: [
          {
            token: TOKEN_B,
            useFactory: () => "B",
            lifetime: "singleton"
          }
        ]
      });

      const compositeModule = DiModule.create({
        imports: [moduleA, moduleB],
        providers: [
          {
            token: TOKEN_C,
            useFactory: () => "C",
            lifetime: "singleton"
          }
        ]
      });

      configurator.addModule(compositeModule);
      const container = await configurator.build();

      assert.equal(await container.resolve(TOKEN_A), "A");
      assert.equal(await container.resolve(TOKEN_B), "B");
      assert.equal(await container.resolve(TOKEN_C), "C");
    });

    it("should prevent duplicate module registration", async () => {
      const TEST_TOKEN = Symbol("TEST");
      let registerCount = 0;

      const testModule: IDiModule = {
        register: (config) => {
          registerCount++;
          config.addSingleton(TEST_TOKEN, () => "test");
        }
      };

      configurator.addModule(testModule);
      configurator.addModule(testModule);
      configurator.addModule(testModule);

      assert.equal(registerCount, 1);
    });

    it("should handle circular module imports", async () => {
      const TOKEN_A = Symbol("A");
      const TOKEN_B = Symbol("B");

      const moduleA: IDiModule = {
        register: (config) => {
          config.addSingleton(TOKEN_A, () => "Value A");
          config.addModule(moduleB);
        }
      };

      const moduleB: IDiModule = {
        register: (config) => {
          config.addSingleton(TOKEN_B, () => "Value B");
          config.addModule(moduleA);
        }
      };

      configurator.addModule(moduleA);
      const container = await configurator.build();

      assert.equal(await container.resolve(TOKEN_A), "Value A");
      assert.equal(await container.resolve(TOKEN_B), "Value B");
    });
  });

  describe("Real-world Module Scenarios", () => {
    it("should properly inject dependencies between modules", async () => {
      const CONFIG_TOKEN = Symbol("CONFIG");
      const LOGGER_TOKEN = Symbol("LOGGER");
      const SERVICE_TOKEN = Symbol("SERVICE");

      class Logger {
        constructor(private config: any) {}

        log(message: string) {
          return `${this.config.logPrefix}: ${message}`;
        }
      }

      class TestService {
        constructor(private logger: Logger) {}

        performOperation() {
          return this.logger.log("Operation performed");
        }
      }

      const configModule = DiModule.create({
        providers: [
          {
            token: CONFIG_TOKEN,
            useFactory: () => ({ logPrefix: "TEST" }),
            lifetime: "singleton"
          }
        ]
      });

      const loggerModule = DiModule.create({
        imports: [configModule],
        providers: [
          {
            token: LOGGER_TOKEN,
            useFactory: async (di: DiConfigurator) => {
              const config = await di.resolve(CONFIG_TOKEN);
              return new Logger(config);
            },
            lifetime: "singleton"
          }
        ]
      });

      const serviceModule = DiModule.create({
        imports: [loggerModule],
        providers: [
          {
            token: SERVICE_TOKEN,
            useFactory: async (di: DiConfigurator) => {
              const logger = await di.resolveRequired<Logger>(LOGGER_TOKEN);
              return new TestService(logger);
            },
            lifetime: "singleton"
          }
        ]
      });

      configurator.addModule(serviceModule);
      const container = await configurator.build();

      const service = await container.resolveRequired<TestService>(SERVICE_TOKEN);
      const result = service.performOperation();

      assert.equal(result, "TEST: Operation performed");
    });

    it("should support module hierarchies similar to the example app", async () => {
      interface ILogger {
        log(message: string): string;
      }

      interface IUserService {
        getCurrentUser(): string;
      }

      interface IAuthService {
        isAuthenticated(): boolean;
      }

      class ConsoleLogger implements ILogger {
        log(message: string): string {
          return `[LOG] ${message}`;
        }
      }

      class AuthServiceImpl implements IAuthService {
        constructor(private logger: ILogger) {}

        isAuthenticated(): boolean {
          this.logger.log("Checking authentication");
          return true;
        }
      }

      class UserServiceImpl implements IUserService {
        constructor(private logger: ILogger, private authService: IAuthService) {}

        getCurrentUser(): string {
          this.logger.log("Getting current user");
          return this.authService.isAuthenticated() ? "John Doe" : "Guest";
        }
      }

      const LOGGER = Symbol("LOGGER");
      const USER_SERVICE = Symbol("USER_SERVICE");
      const AUTH_SERVICE = Symbol("AUTH_SERVICE");

      const LoggingModule = DiModule.create({
        providers: [
          {
            token: LOGGER,
            useFactory: () => new ConsoleLogger(),
            lifetime: "singleton"
          }
        ]
      });

      const AuthModule = DiModule.create({
        imports: [LoggingModule],
        providers: [
          {
            token: AUTH_SERVICE,
            useFactory: async (di: DiConfigurator) => {
              const logger = await di.resolveRequired<ILogger>(LOGGER);
              return new AuthServiceImpl(logger);
            },
            lifetime: "singleton"
          }
        ]
      });

      const UserModule = DiModule.create({
        imports: [LoggingModule, AuthModule],
        providers: [
          {
            token: USER_SERVICE,
            useFactory: async (di: DiConfigurator) => {
              const logger = await di.resolveRequired<ILogger>(LOGGER);
              const authService = await di.resolveRequired<IAuthService>(AUTH_SERVICE);
              return new UserServiceImpl(logger, authService);
            },
            lifetime: "singleton"
          }
        ]
      });

      const AppModule = DiModule.create({
        imports: [UserModule]
      });

      configurator.addModule(AppModule);
      const container = await configurator.build();

      const userService = await container.resolveRequired<IUserService>(USER_SERVICE);
      const currentUser = userService.getCurrentUser();

      assert.equal(currentUser, "John Doe");
    });
  });
});
