# @apiratorjs/di-container

[![NPM version](https://img.shields.io/npm/v/@apiratorjs/di-container.svg)](https://www.npmjs.com/package/@apiratorjs/di-container)
[![License: MIT](https://img.shields.io/npm/l/@apiratorjs/di-container.svg)](https://github.com/apiratorjs/di-container/blob/main/LICENSE)

A lightweight dependency injection container for JavaScript and TypeScript with powerful features: modular organization with DiModule.create, service discovery for runtime introspection, service tagging for multiple implementations, lazy initialization, automatic circular dependency detection, and multiple service lifecycles (singleton with both in-place and lazy initialization, request-scoped, transient). Includes built-in async context management, lifecycle hooks (onConstruct/onDispose), and remains completely framework-agnostic for flexible application architecture.

> **Note:** Requires Node.js version **>=16.4.0**
 
---

## Features

- **Multiple Lifecycles:**
    - **Singleton:** One instance per application. By default lazily initialized (created only when requested), but can be configured for eager initialization during DI build step.
    - **Request-Scoped:** One instance per request scope using asynchronous context (lazily loaded).
    - **Transient:** A new instance on every resolution.

- **Service Tags:** Support for registering multiple implementations of the same service token using tags, enabling flexible service resolution based on context.
- **Lazy Initialization:** Services are only created when requested (default for singletons).
- **Async Context Management:** Leverages [@apiratorjs/async-context](https://github.com/apiratorjs/async-context) to
  manage request scopes.
- **Circular Dependency Detection:** Automatically detects and reports circular dependencies with detailed chain information through `CircularDependencyError`.
- **Lifecycle Hooks:** Services can implement onConstruct() and onDispose() for custom initialization and cleanup.
    - **Singleton:** Supports both onConstruct() and onDispose() hooks.
    - **Request-Scoped:** Supports both onConstruct() and onDispose() hooks.
    - **Transient:** Supports only onConstruct() hooks.
- **Concurrency Safety:** Designed to avoid race conditions during lazy instantiation.
- **Service Discovery:** Built-in discovery service for introspecting registered services by token, lifetime, tag, or getting all registrations.
- **Modular Organization:** Services can be organized into modules, allowing for better separation of concerns and reusability.

---

## Installation

Install via npm:

```bash
npm install @apiratorjs/di-container
```

Or using yarn:

```bash
yarn add @apiratorjs/di-container
```

## Usage

### Basic Setup

Create and configure your DI container using the DiConfigurator, then build a DiContainer for runtime service
resolution.

Any service is registered with a factory function that returns a promise of the service instance. Tokens are used to
identify services.
Tokens can be strings, symbols, or classes.

```typescript
import { DiConfigurator } from "@apiratorjs/di-container";
import { AsyncContextStore } from "@apiratorjs/async-context";

// Create a configurator instance.
const diConfigurator = new DiConfigurator();

// Register a singleton service (default: lazy initialization, created only when requested).
diConfigurator.addSingleton("MY_SINGLETON", async () => {
  return new MySingletonService();
});

// Register a singleton service with eager initialization (created during container build).
diConfigurator.addSingleton("MY_EAGER_SINGLETON", async () => {
  return new MySingletonService();
}, { eager: true });

// Register a request-scoped service.
diConfigurator.addScoped("MY_SCOPED", async () => {
  return new MyScopedService();
});

// Register a transient service.
diConfigurator.addTransient("MY_TRANSIENT", async () => {
  return new MyTransientService();
});

// Build the container.
const diContainer = diConfigurator.build();
```

### Resolving Services

You can resolve services directly via the configurator or through the built container:

```typescript
// Resolve a singleton service.
const singletonInstance = await diConfigurator.resolve("MY_SINGLETON");

// Resolve a transient service.
const transientInstance = await diConfigurator.resolve("MY_TRANSIENT");
```

### Using Request Scopes

For services registered as scoped, you must resolve them within a request scope:

```typescript
import { AsyncContextStore } from "@apiratorjs/async-context";

await diContainer.runWithNewRequestScope(new AsyncContextStore(), async () => {
  const scopedInstance = await diContainer.resolve("MY_SCOPED");
  console.log(scopedInstance);
});
```

> [!WARNING]
> You cannot resolve a request-scoped service outside of a request scope.

### Lifecycle Hooks

If a service implements the optional lifecycle hooks (onConstruct and/or onDispose), they are invoked automatically when
the service is created and disposed.

```typescript
diConfigurator.addSingleton("HOOKED_SINGLETON", async () => {
  return {
    async onConstruct() {
      console.log("Service constructed!");
    },
    async onDispose() {
      console.log("Service disposed!");
    }
  };
});
```

When the service is resolved for the first time, onConstruct() is called; later, when the container disposes of the
service, onDispose() is invoked.

### Service Tags

Service tags allow you to register multiple implementations of the same service token, enabling flexible service resolution based on context. This is useful for scenarios like feature flags, environment-specific implementations, or multi-tenant applications.

```typescript
// Register multiple implementations of the same service with different tags
diConfigurator.addSingleton("DATABASE_CONNECTION", async () => {
  return new PostgreSQLConnection();
}, undefined, "postgresql");

diConfigurator.addSingleton("DATABASE_CONNECTION", async () => {
  return new MySQLConnection();
}, undefined, "mysql");

diConfigurator.addSingleton("DATABASE_CONNECTION", async () => {
  return new InMemoryConnection();
}, undefined, "inmemory");

// Resolve specific implementations using tags
const postgresConnection = await diConfigurator.resolve("DATABASE_CONNECTION", "postgresql");
const mysqlConnection = await diConfigurator.resolve("DATABASE_CONNECTION", "mysql");
const inMemoryConnection = await diConfigurator.resolve("DATABASE_CONNECTION", "inmemory");
```

Tags work with all service lifecycles:

```typescript
// Singleton with tags
diConfigurator.addSingleton("LOGGER", async () => new ConsoleLogger(), undefined, "console");
diConfigurator.addSingleton("LOGGER", async () => new FileLogger(), undefined, "file");

// Scoped with tags
diConfigurator.addScoped("USER_CONTEXT", async () => new AdminContext(), "admin");
diConfigurator.addScoped("USER_CONTEXT", async () => new GuestContext(), "guest");

// Transient with tags
diConfigurator.addTransient("NOTIFICATION", async () => new EmailNotification(), "email");
diConfigurator.addTransient("NOTIFICATION", async () => new SMSNotification(), "sms");
```

If no tag is specified during resolution, the service registered with the "default" tag (or no tag) will be returned.

### Service Registration Behavior

When registering multiple services with the same token and tag, the **first** registration wins and subsequent registrations are ignored:

```typescript
// This implementation will be used
diConfigurator.addSingleton("MY_SERVICE", async () => {
  return new FirstImplementation();
});

// This registration will be ignored (same token, same default tag)
diConfigurator.addSingleton("MY_SERVICE", async () => {
  return new SecondImplementation();
});

// This works the same way for all service types (singleton, scoped, transient)
```

To register multiple implementations of the same service, use different tags:

```typescript
// Both implementations will be registered with different tags
diConfigurator.addSingleton("MY_SERVICE", async () => {
  return new FirstImplementation();
}, undefined, "first");

diConfigurator.addSingleton("MY_SERVICE", async () => {
  return new SecondImplementation();
}, undefined, "second");

// Resolve specific implementations
const firstImpl = await diConfigurator.resolve("MY_SERVICE", "first");
const secondImpl = await diConfigurator.resolve("MY_SERVICE", "second");
```

This behavior ensures that accidental duplicate registrations don't silently override existing services, while still allowing multiple implementations through the tagging system.

### Service Discovery

The DI container includes a built-in discovery service that allows you to introspect and query registered services. This is particularly useful for debugging, monitoring, testing, and building dynamic service resolution logic.

#### Accessing the Discovery Service

You can access the discovery service through both the DiConfigurator and the built DiContainer:

```typescript
import { DiConfigurator } from "@apiratorjs/di-container";

const diConfigurator = new DiConfigurator();

// Register some services
diConfigurator.addSingleton("DATABASE", () => new DatabaseService(), undefined, "infrastructure");
diConfigurator.addScoped("USER_SERVICE", () => new UserService(), "business");
diConfigurator.addTransient("LOGGER", () => new LoggerService(), "utility");

// Access discovery service from configurator
const discoveryService = diConfigurator.getDiscoveryService();

// Or from the built container
const container = diConfigurator.build();
const containerDiscoveryService = container.getDiscoveryService();
```

#### Discovery Methods

The discovery service provides several methods to query registered services:

**Get All Services:**
```typescript
// Get all registered services
const allServices = discoveryService.getAll({});
console.log(`Total services registered: ${allServices.length}`);

// Each service registration contains:
// - token: The service token (string, symbol, or class)
// - tokenType: "string" | "symbol" | "class"
// - lifetime: "singleton" | "scoped" | "transient"
// - tag: The service tag
// - isResolved: Whether the service has been instantiated
// - singletonOptions: Options for singleton services (e.g., eager initialization)
```

**Query by Service Token:**
```typescript
// Find services by their token
const databaseServices = discoveryService.getServicesByServiceToken("DATABASE");
const symbolServices = discoveryService.getServicesByServiceToken(MySymbolToken);
const classServices = discoveryService.getServicesByServiceToken(MyServiceClass);
```

**Query by Lifetime:**
```typescript
// Find all singleton services
const singletonServices = discoveryService.getServicesByLifetime("singleton");

// Find all scoped services
const scopedServices = discoveryService.getServicesByLifetime("scoped");

// Find all transient services
const transientServices = discoveryService.getServicesByLifetime("transient");
```

**Query by Tag:**
```typescript
// Find services by tag
const infrastructureServices = discoveryService.getServicesByTag("infrastructure");
const businessServices = discoveryService.getServicesByTag("business");
const utilityServices = discoveryService.getServicesByTag("utility");
```

#### Practical Use Cases

**Service Health Monitoring:**
```typescript
// Check which services are eagerly initialized
const eagerSingletons = discoveryService
  .getServicesByLifetime("singleton")
  .filter(service => service.singletonOptions?.eager === true);

console.log("Eager singletons:", eagerSingletons.map(s => s.token));
```

**Testing and Debugging:**
```typescript
// Verify all expected services are registered
const expectedServices = ["DATABASE", "USER_SERVICE", "LOGGER"];
const registeredTokens = discoveryService.getAll({}).map(s => s.token);

expectedServices.forEach(token => {
  if (!registeredTokens.includes(token)) {
    console.warn(`Missing service: ${token}`);
  }
});
```

**Dynamic Service Resolution:**
```typescript
// Get all services with a specific tag for batch processing
const infrastructureServices = discoveryService.getServicesByTag("infrastructure");

for (const serviceReg of infrastructureServices) {
  if (serviceReg.lifetime === "singleton") {
    const instance = await container.resolve(serviceReg.token);
    console.log(`Initialized infrastructure service: ${serviceReg.token}`);
  }
}
```

**Service Documentation Generation:**
```typescript
// Generate service inventory
const serviceInventory = discoveryService.getAll({}).map(service => ({
  token: service.token.toString(),
  type: service.tokenType,
  lifetime: service.lifetime,
  tag: service.tag,
  eager: service.singletonOptions?.eager || false
}));

console.table(serviceInventory);
```

### Circular Dependency Detection

The container automatically detects circular dependencies during service resolution and throws a `CircularDependencyError` with detailed information about the dependency chain:

```typescript
// This would create a circular dependency
diConfigurator.addSingleton("ServiceA", async (di) => {
  await di.resolve("ServiceB");
  return new ServiceA();
});

diConfigurator.addSingleton("ServiceB", async (di) => {
  await di.resolve("ServiceA");
  return new ServiceB();
});

// This will throw CircularDependencyError
try {
  await diConfigurator.resolve("ServiceA");
} catch (error) {
  if (error instanceof CircularDependencyError) {
    // error.chain contains the full dependency chain: ["ServiceA", "ServiceB", "ServiceA"]
    console.error(`Circular dependency detected: ${error.chain.join(" -> ")}`);
  }
}
```

The error provides a complete dependency chain for debugging purposes, making it easier to identify and fix circular dependencies in your application.

### Basic Example

```typescript
import { DiConfigurator } from "../src";
import { IOnConstruct, IOnDispose } from "../src/types";
import { AsyncContextStore } from "@apiratorjs/async-context";

class User {
  public constructor(
    public readonly email: string,
    public readonly age: number
  ) {}
}

class Config {
  public dbProvider = "in_memory";
}

// Emulate a db storage
const users: User[] = [];

class DBContext implements IOnConstruct, IOnDispose {
  public constructor(private readonly _config: Config) {}

  onDispose(): Promise<void> | void {
    console.log("DBContext disposed");
  }

  onConstruct(): Promise<void> | void {
    console.log("DBContext constructed. Provider: ", this._config.dbProvider);
  }

  findUserByEmail(email: string): User | undefined {
    return users.find(user => user.email === email);
  }

  addUser(user: User): void {
    users.push(user);
  }
}

class UserService {
  public constructor(private readonly _db: DBContext) {}

  public getUserByEmail(email: string): User | undefined {
    return this._db.findUserByEmail(email);
  }

  public addUser(user: User): void {
    this._db.addUser(user);
  }
}

const diConfigurator = new DiConfigurator();

diConfigurator.addSingleton(Config, () => new Config());
diConfigurator.addScoped(DBContext, async (cfg) => {
  const config = await cfg.resolve(Config);
  return new DBContext(config);
});
diConfigurator.addScoped(UserService, async (cfg) => {
  const dbContext = await cfg.resolve(DBContext);
  return new UserService(dbContext);
});

const diContainer = diConfigurator.build();

(async () => {
  // To use request-scoped services, you need to create a new scope
  await diContainer.runWithNewRequestScope(new AsyncContextStore(), async () => {
    const userService = await diContainer.resolve(UserService);

    userService.addUser(new User("john@doe.com", 30));
  });

  const user = await diContainer.runWithNewRequestScope(new AsyncContextStore(), async () => {
    const userService = await diContainer.resolve(UserService);

    return userService.getUserByEmail("john@doe.com");
  });

  console.log("User: ", user);
})();

/**
 * Output:
 *
 * DBContext constructed. Provider:  in_memory
 * DBContext disposed
 * DBContext constructed. Provider:  in_memory
 * DBContext disposed
 * User:  User { email: 'john@doe.com', age: 30 }
 */
```

### Service Discovery Example

Here's a comprehensive example demonstrating the discovery service capabilities:

```typescript
import { DiConfigurator } from "@apiratorjs/di-container";

// Define service classes
class DatabaseService {
  public readonly name = "DatabaseService";
  public connect() { return "connected"; }
}

class CacheService {
  public readonly name = "CacheService";
  public get(key: string) { return `cached_${key}`; }
}

class LoggerService {
  public readonly name = "LoggerService";
  public log(message: string) { console.log(`[LOG] ${message}`); }
}

class ApiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggerService
  ) {}
  
  public getData() {
    this.logger.log("Getting data from API");
    return "API data";
  }
}

// Service tokens
const DATABASE_TOKEN = Symbol("DATABASE");
const CACHE_TOKEN = "CACHE_SERVICE";
const LOGGER_TOKEN = LoggerService;
const API_TOKEN = "API_SERVICE";

const diConfigurator = new DiConfigurator();

// Register services with different lifetimes and tags
diConfigurator.addSingleton(DATABASE_TOKEN, () => new DatabaseService(), { eager: true }, "infrastructure");
diConfigurator.addSingleton(CACHE_TOKEN, () => new CacheService(), undefined, "infrastructure");
diConfigurator.addSingleton(LOGGER_TOKEN, () => new LoggerService(), undefined, "utility");

diConfigurator.addScoped(API_TOKEN, async (container) => {
  const db = await container.resolve(DATABASE_TOKEN);
  const cache = await container.resolve(CACHE_TOKEN);
  const logger = await container.resolve(LOGGER_TOKEN);
  return new ApiService(db, cache, logger);
}, "business");

// Multiple implementations with tags
diConfigurator.addTransient("NOTIFICATION", () => ({ send: (msg: string) => console.log(`Email: ${msg}`) }), "email");
diConfigurator.addTransient("NOTIFICATION", () => ({ send: (msg: string) => console.log(`SMS: ${msg}`) }), "sms");

// Get discovery service
const discoveryService = diConfigurator.getDiscoveryService();

// Discovery examples
console.log("=== Service Discovery Examples ===\n");

// 1. Get all services
const allServices = discoveryService.getAll({});
console.log(`Total registered services: ${allServices.length}\n`);

// 2. Query by lifetime
const singletonServices = discoveryService.getServicesByLifetime("singleton");
console.log("Singleton services:");
singletonServices.forEach(service => {
  const eager = service.singletonOptions?.eager ? " (eager)" : " (lazy)";
  console.log(`  - ${service.token.toString()}${eager} [${service.tag}]`);
});

const scopedServices = discoveryService.getServicesByLifetime("scoped");
console.log(`\nScoped services: ${scopedServices.length}`);
scopedServices.forEach(service => {
  console.log(`  - ${service.token} [${service.tag}]`);
});

const transientServices = discoveryService.getServicesByLifetime("transient");
console.log(`\nTransient services: ${transientServices.length}`);
transientServices.forEach(service => {
  console.log(`  - ${service.token} [${service.tag}]`);
});

// 3. Query by tag
console.log("\n=== Services by Tag ===");
const infrastructureServices = discoveryService.getServicesByTag("infrastructure");
console.log(`Infrastructure services: ${infrastructureServices.length}`);
infrastructureServices.forEach(service => {
  console.log(`  - ${service.token.toString()} (${service.lifetime})`);
});

const businessServices = discoveryService.getServicesByTag("business");
console.log(`\nBusiness services: ${businessServices.length}`);
businessServices.forEach(service => {
  console.log(`  - ${service.token} (${service.lifetime})`);
});

// 4. Query by token
console.log("\n=== Query by Token ===");
const databaseService = discoveryService.getServicesByServiceToken(DATABASE_TOKEN);
console.log(`Database service registrations: ${databaseService.length}`);
if (databaseService.length > 0) {
  const service = databaseService[0];
  console.log(`  Token type: ${service.tokenType}`);
  console.log(`  Lifetime: ${service.lifetime}`);
  console.log(`  Tag: ${service.tag}`);
  console.log(`  Eager: ${service.singletonOptions?.eager || false}`);
}

// 5. Find services with multiple implementations
const notificationServices = discoveryService.getServicesByServiceToken("NOTIFICATION");
console.log(`\nNotification implementations: ${notificationServices.length}`);
notificationServices.forEach(service => {
  console.log(`  - Tag: ${service.tag}, Lifetime: ${service.lifetime}`);
});

// 6. Service health check
console.log("\n=== Service Health Check ===");
const eagerServices = discoveryService
  .getServicesByLifetime("singleton")
  .filter(service => service.singletonOptions?.eager === true);

console.log(`Eager singletons (${eagerServices.length}):`);
eagerServices.forEach(service => {
  console.log(`  - ${service.token.toString()}`);
});

// 7. Generate service inventory
console.log("\n=== Service Inventory ===");
const inventory = discoveryService.getAll({}).map(service => ({
  Token: service.token.toString(),
  Type: service.tokenType,
  Lifetime: service.lifetime,
  Tag: service.tag,
  Eager: service.singletonOptions?.eager || false
}));

console.table(inventory);

/**
 * Expected Output:
 * 
 * === Service Discovery Examples ===
 * 
 * Total registered services: 6
 * 
 * Singleton services:
 *   - Symbol(DATABASE) (eager) [infrastructure]
 *   - CACHE_SERVICE (lazy) [infrastructure]
 *   - class LoggerService (lazy) [utility]
 * 
 * Scoped services: 1
 *   - API_SERVICE [business]
 * 
 * Transient services: 2
 *   - NOTIFICATION [email]
 *   - NOTIFICATION [sms]
 * 
 * === Services by Tag ===
 * Infrastructure services: 2
 *   - Symbol(DATABASE) (singleton)
 *   - CACHE_SERVICE (singleton)
 * 
 * Business services: 1
 *   - API_SERVICE (scoped)
 * 
 * === Query by Token ===
 * Database service registrations: 1
 *   Token type: symbol
 *   Lifetime: singleton
 *   Tag: infrastructure
 *   Eager: true
 * 
 * Notification implementations: 2
 *   - Tag: email, Lifetime: transient
 *   - Tag: sms, Lifetime: transient
 * 
 * === Service Health Check ===
 * Eager singletons (1):
 *   - Symbol(DATABASE)
 * 
 * === Service Inventory ===
 * ┌─────────┬──────────────────────┬──────────┬──────────────┬──────────────────┬───────┐
 * │ (index) │        Token         │   Type   │   Lifetime   │       Tag        │ Eager │
 * ├─────────┼──────────────────────┼──────────┼──────────────┼──────────────────┼───────┤
 * │    0    │   'Symbol(DATABASE)' │ 'symbol' │ 'singleton'  │ 'infrastructure' │ true  │
 * │    1    │   'CACHE_SERVICE'    │ 'string' │ 'singleton'  │ 'infrastructure' │ false │
 * │    2    │ 'class LoggerService'│ 'class'  │ 'singleton'  │    'utility'     │ false │
 * │    3    │    'API_SERVICE'     │ 'string' │   'scoped'   │    'business'    │ false │
 * │    4    │   'NOTIFICATION'     │ 'string' │ 'transient'  │     'email'      │ false │
 * │    5    │   'NOTIFICATION'     │ 'string' │ 'transient'  │      'sms'       │ false │
 * └─────────┴──────────────────────┴──────────┴──────────────┴──────────────────┴───────┘
 */
```

## Dependency Injection Modules

The DI container supports organizing your dependencies into logical modules, making it easier to manage complex applications with many services. Modules provide a way to group related services together and can be reused across different parts of your application.

### Creating a Module

A module is a class or object that defines a set of related services:

```typescript
import { DiConfigurator } from "@apiratorjs/di-container";
import { IDiModule } from "./types";

// Define a module for database-related services
class DatabaseModule implements IDiModule {
  public register(configurator: DiConfigurator): void {
    // Register database-related services
    configurator.addSingleton("DATABASE_CONNECTION", async () => {
      return new DatabaseConnection(/* connection params */);
    });

    configurator.addScoped("TRANSACTION_MANAGER", async (di) => {
      const connection = await di.resolve("DATABASE_CONNECTION");
      return new TransactionManager(connection);
    });
  }
}

// Define a module for user-related services
class UserModule implements IDiModule {
  public register(configurator: DiConfigurator): void {
    // Register user-related services
    configurator.addScoped("USER_REPOSITORY", async (di) => {
      const transactionManager = await di.resolve("TRANSACTION_MANAGER");
      return new UserRepository(transactionManager);
    });

    configurator.addScoped("USER_SERVICE", async (di) => {
      const userRepository = await di.resolve("USER_REPOSITORY");
      return new UserService(userRepository);
    });
  }
}
```

### Using DiModule.create

For a more declarative approach, you can use the `DiModule.create` static method to create modules with a configuration object:

```typescript
import { DiModule } from "@apiratorjs/di-container";

// Define service tokens
const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");
const EAGER_DATABASE_CONNECTION = Symbol("EAGER_DATABASE_CONNECTION");
const TRANSACTION_MANAGER = Symbol("TRANSACTION_MANAGER");
const USER_REPOSITORY = Symbol("USER_REPOSITORY");
const USER_SERVICE = Symbol("USER_SERVICE");

// Create a database module
const DatabaseModule = DiModule.create({
  providers: [
    {
      token: DATABASE_CONNECTION,
      useFactory: async () => {
        return new DatabaseConnection(/* connection params */);
      },
      lifetime: "singleton"
      // By default, lazy initialization (created only when requested)
    },
    {
      token: EAGER_DATABASE_CONNECTION,
      useFactory: async () => {
        return new DatabaseConnection(/* connection params */);
      },
      lifetime: "singleton",
      singletonOptions: { eager: true } // Will be created during container build
    },
    {
      token: TRANSACTION_MANAGER,
      useFactory: async (di) => {
        const connection = await di.resolve(DATABASE_CONNECTION);
        return new TransactionManager(connection);
      },
      lifetime: "scoped"
    }
  ]
});

// Create a user module that imports the database module
const UserModule = DiModule.create({
  imports: [DatabaseModule], // Import other modules
  providers: [
    {
      token: USER_REPOSITORY,
      useFactory: async (di) => {
        const txManager = await di.resolve(TRANSACTION_MANAGER);
        return new UserRepository(txManager);
      },
      lifetime: "scoped"
    },
    {
      token: USER_SERVICE,
      useFactory: async (di) => {
        const userRepo = await di.resolve(USER_REPOSITORY);
        return new UserService(userRepo);
      },
      lifetime: "scoped"
    }
  ]
});
```

The `DiModule.create` method accepts a `ModuleOptions` object with the following properties:

- `imports`: An array of other modules to import
- `providers`: An array of service provider configurations, each with:
  - `token`: The service token (string, symbol, or class)
  - `useFactory`: A factory function that creates the service
  - `lifetime`: The service lifetime ("singleton", "scoped", or "transient")
  - `singletonOptions`: Additional options for singleton services:
    - `{ eager: true }` - When true, the singleton will be created during DI build step instead of lazy initialization
  - `tag`: Optional tag to distinguish between multiple implementations of the same service token

Here's an example showing how to use tags with DiModule.create:

```typescript
// Create a module with tagged services
const LoggingModule = DiModule.create({
  providers: [
    {
      token: "LOGGER",
      useFactory: () => new ConsoleLogger(),
      lifetime: "singleton",
      tag: "console"
    },
    {
      token: "LOGGER",
      useFactory: () => new FileLogger(),
      lifetime: "singleton",
      tag: "file"
    },
    {
      token: "LOGGER",
      useFactory: () => new DatabaseLogger(),
      lifetime: "singleton",
      singletonOptions: { eager: true },
      tag: "database"
    }
  ]
});
```

This declarative approach makes it easy to organize your services and their dependencies, and enables importing modules into other modules.

### Using Modules

You can register modules with your DiConfigurator using the `addModule` method:

```typescript
const diConfigurator = new DiConfigurator();

// Register a custom module class
const databaseModule = new DatabaseModule();
diConfigurator.addModule(databaseModule);

// Register a module created with DiModule.create
const userModule = DiModule.create({
  // module options
});
diConfigurator.addModule(userModule);

// Build the container
const diContainer = diConfigurator.build();
```

#### Organizing Modules

For larger applications, you can organize your modules in a hierarchical structure:

```typescript
// Create the core modules
const coreModule = DiModule.create({
  providers: [/* core services */]
});

const dataModule = DiModule.create({
  imports: [coreModule],
  providers: [/* data services */]
});

// Create feature modules that depend on core and data modules
const featureModule = DiModule.create({
  imports: [coreModule, dataModule],
  providers: [/* feature-specific services */]
});

// Create the root application module
const appModule = DiModule.create({
  imports: [
    coreModule,
    dataModule,
    featureModule,
    // other feature modules
  ],
  providers: [/* app-specific services */]
});

// Register only the root module
const diConfigurator = new DiConfigurator();
diConfigurator.addModule(appModule);
```

#### Module Registration Order

When registering multiple modules, be aware that:

1. Services are registered in the order modules are added
2. When the same service token is registered multiple times, the last registration wins
3. When using imports, the imported modules are registered before the importing module

This allows for service overrides and customization at different levels of your module hierarchy.

### Benefits of Using Modules

1. **Organization**: Group related services together for better code organization.
2. **Reusability**: Modules can be reused across different applications or parts of the same application.
3. **Maintainability**: Easier to maintain and update services when they're organized into logical modules.
4. **Separation of Concerns**: Each module can focus on a specific aspect of the application.
5. **Testing**: Modules make it easier to mock dependencies for testing purposes.

### Module Best Practices

- Keep modules focused on a specific domain or functionality.
- Avoid circular dependencies between modules.
- Use descriptive names for tokens to clearly identify services within a module.
- Document dependencies between modules to make the application structure clearer.

### Complete Module Example

Here's a comprehensive example that demonstrates how to use DiModule.create to organize a complete application with multiple modules and dependencies:

```typescript
import { DiConfigurator, DiModule } from "@apiratorjs/di-container";

// Define interfaces
interface ILogger {
  log(message: string): void;
}

interface IAuthService {
  isAuthenticated(): boolean;
}

interface IUserService {
  getCurrentUser(): string;
}

// Implement services
class ConsoleLogger implements ILogger {
  log(message: string): void {
    console.log(`[LOG] ${message}`);
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

// Define service tokens
const LOGGER = Symbol("LOGGER");
const AUTH_SERVICE = Symbol("AUTH_SERVICE");
const USER_SERVICE = Symbol("USER_SERVICE");

// Create modules
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
  imports: [LoggingModule], // Import logging module
  providers: [
    {
      token: AUTH_SERVICE,
      useFactory: async (cfg: DiConfigurator) => {
        const logger = await cfg.resolve<ILogger>(LOGGER);
        return new AuthServiceImpl(logger);
      },
      lifetime: "singleton"
    }
  ]
});

const UserModule = DiModule.create({
  imports: [LoggingModule, AuthModule], // Import both modules
  providers: [
    {
      token: USER_SERVICE,
      useFactory: async (cfg: DiConfigurator) => {
        const logger = await cfg.resolve<ILogger>(LOGGER);
        const authService = await cfg.resolve<IAuthService>(AUTH_SERVICE);
        return new UserServiceImpl(logger, authService);
      },
      lifetime: "singleton"
    }
  ]
});

// Create the application module that imports all other modules
const AppModule = DiModule.create({
  imports: [UserModule],
  providers: [
    // You can add app-specific services here
  ]
});

// Usage
async function main() {
  const configurator = new DiConfigurator();
  
  // Register the top-level module
  configurator.addModule(AppModule);
  
  // Build the container
  const container = configurator.build();
  
  // Resolve and use a service
  const userService = await container.resolve<IUserService>(USER_SERVICE);
  const currentUser = userService.getCurrentUser();
  console.log(`Current user: ${currentUser}`);
  
  // Clean up
  await container.dispose();
}

main().catch(console.error);
```

Output:
```
[LOG] Checking authentication
[LOG] Getting current user
Current user: John Doe
```

This example demonstrates:
- Creating multiple modules with different responsibilities
- Importing modules into other modules to establish dependencies
- Using symbols as service tokens for type safety
- Resolving dependencies between services across different modules
- Proper disposal of services when they're no longer needed

### Contributing

Contributions, issues, and feature requests are welcome!
Please open an issue or submit a pull request on [GitHub](https://github.com/apiratorjs/di-container).
