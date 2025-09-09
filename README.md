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

### Quick Start

Create and configure your DI container with the DiConfigurator, then build a DiContainer for runtime usage:

```typescript
import { DiConfigurator } from "@apiratorjs/di-container";
import { AsyncContextStore } from "@apiratorjs/async-context";

// Service classes with lifecycle hooks
class DatabaseService {
  async onConstruct() { console.log("Database connected"); }
  async onDispose() { console.log("Database disconnected"); }
  
  async query(sql: string) { return `Result for: ${sql}`; }
}

class UserService {
  constructor(private db: DatabaseService) {}
  
  async getUser(id: string) {
    return await this.db.query(`SELECT * FROM users WHERE id = ${id}`);
  }
}

// Configure services with different lifecycles and options
const configurator = new DiConfigurator();

// Singleton with eager initialization
configurator.addSingleton("DATABASE", () => new DatabaseService(), { eager: true });

// Scoped service with dependency injection
configurator.addScoped("USER_SERVICE", async (cfg) => {
  const db = await cfg.resolve("DATABASE");
  return new UserService(db);
});

// Transient service
configurator.addTransient("LOGGER", () => ({ log: (msg) => console.log(`[LOG] ${msg}`) }));

// Build container (eagerly initializes singletons)
const container = await configurator.build();

// Use services - scoped services REQUIRE a request scope
await container.runWithNewRequestScope(new AsyncContextStore(), async () => {
  const userService = await container.resolve("USER_SERVICE"); // ✅ Works in scope
  const logger = await container.resolve("LOGGER");
  
  const user = await userService.getUser("123");
  logger.log(`Retrieved user: ${user}`);
});

// ❌ This would throw RequestScopeResolutionError:
// await container.resolve("USER_SERVICE"); // Error: scoped service outside scope

// Cleanup when done
await container.dispose();
```

### Core Concepts

**Service Lifecycles:**
- **Singleton**: One instance per application (lazy by default, can be eager)
- **Scoped**: One instance per request scope - **MUST** be used within `runWithNewRequestScope()`, throws `RequestScopeResolutionError` otherwise
- **Transient**: New instance on every resolution

**Important:** Scoped services cannot be resolved outside a request scope:
```typescript
// ✅ Correct usage
await container.runWithNewRequestScope(new AsyncContextStore(), async () => {
  const scopedService = await container.resolve("SCOPED_SERVICE"); // Works
});

// ❌ This throws RequestScopeResolutionError
const scopedService = await container.resolve("SCOPED_SERVICE"); // Error!
```

**Service Tags (Optional):** Register multiple implementations when needed:
```typescript
configurator.addSingleton("PAYMENT", () => new StripePayment(), undefined, "stripe");
configurator.addSingleton("PAYMENT", () => new PayPalPayment(), undefined, "paypal");
```

**Lifecycle Hooks:** Services can implement `onConstruct()` and `onDispose()` for automatic initialization and cleanup.

## IDiConfigurator Interface

The `IDiConfigurator` is the main interface for configuring dependency injection services. Here are all available methods:

### Service Registration Methods

| Method | Description | Example |
|--------|-------------|---------|
| `addSingleton<T>(token, factory, options?, tag?)` | Register a singleton service | `configurator.addSingleton("DB", () => new Database(), { eager: true })` |
| `addScoped<T>(token, factory, tag?)` | Register a request-scoped service | `configurator.addScoped("USER_CTX", async (cfg) => new UserContext())` |
| `addTransient<T>(token, factory, tag?)` | Register a transient service | `configurator.addTransient("LOGGER", () => new Logger(), "console")` |
| `addModule(module)` | Register a module with multiple services | `configurator.addModule(new DatabaseModule())` |

### Service Resolution Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `resolve<T>(token, tag?)` | Resolve a service (optional) | `Promise<T \| undefined>` |
| `resolveRequired<T>(token, tag?)` | Resolve a service (throws if not found) | `Promise<T>` |
| `resolveAll<T>(token)` | Resolve all implementations | `Promise<T[]>` |
| `resolveTagged<T>(tag)` | Resolve first service with tag | `Promise<T \| undefined>` |
| `resolveTaggedRequired<T>(tag)` | Resolve service with tag (throws if not found) | `Promise<T>` |
| `resolveAllTagged<T>(tag)` | Resolve all services with tag | `Promise<T[]>` |

### Container Management Methods

| Method | Description | Purpose |
|--------|-------------|---------|
| `build()` | Build the runtime container | Returns `DiContainer` for production use |
| `dispose()` | Dispose all services | Cleanup singletons and scoped services |
| `runWithNewRequestScope(store, callback)` | Execute code in request scope | Required for scoped services |
| `getRequestScopeContext()` | Get current scope context | Returns `AsyncContextStore \| undefined` |
| `isInRequestScopeContext()` | Check if in request scope | Returns `boolean` |
| `getDiscoveryService()` | Get discovery service | For service introspection |

### Practical Example

```typescript
const configurator = new DiConfigurator();

// Registration - various lifecycles and features
configurator
  .addSingleton("CONFIG", () => ({ env: "prod" }), { eager: true })
  .addScoped("REQUEST_ID", () => Math.random().toString(36))
  .addTransient("LOGGER", () => new ConsoleLogger());

// Resolution - different ways to get services
const config = await configurator.resolveRequired("CONFIG"); // ✅ Singleton works anywhere
const loggers = await configurator.resolveAll("LOGGER");

// Container management
const container = await configurator.build();

// ❌ This would throw RequestScopeResolutionError:
// const requestId = await container.resolve("REQUEST_ID"); // Error: scoped service outside scope

// ✅ Correct usage for scoped services:
await container.runWithNewRequestScope(new AsyncContextStore(), async () => {
  const requestId = await container.resolve("REQUEST_ID"); // Works in scope
  console.log(`Processing request: ${requestId}`);
});

await container.dispose();
```

## IDiContainer Interface

The `IDiContainer` is the runtime interface for resolving services after building your DI configuration. It provides a clean, read-only interface focused on service resolution and request scope management.

### Service Resolution Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `resolve<T>(token, tag?)` | Resolve a service (optional) | `Promise<T \| undefined>` |
| `resolveRequired<T>(token, tag?)` | Resolve a service (throws if not found) | `Promise<T>` |
| `resolveAll<T>(token)` | Resolve all implementations | `Promise<T[]>` |
| `resolveTagged<T>(tag)` | Resolve first service with tag | `Promise<T \| undefined>` |
| `resolveTaggedRequired<T>(tag)` | Resolve service with tag (throws if not found) | `Promise<T>` |
| `resolveAllTagged<T>(tag)` | Resolve all services with tag | `Promise<T[]>` |

### Runtime Management Methods

| Method | Description | Purpose |
|--------|-------------|---------|
| `runWithNewRequestScope(store, callback)` | Execute code in request scope | **Required** for scoped services |
| `isInRequestScopeContext()` | Check if in request scope | Returns `boolean` |
| `getRequestScopeContext()` | Get current scope context | Returns `AsyncContextStore \| undefined` |
| `dispose()` | Dispose all services | Cleanup singletons and scoped services |
| `getDiscoveryService()` | Get discovery service | For service introspection |

### Key Differences from IDiConfigurator

**IDiContainer is for runtime usage only:**
- ✅ **Service Resolution**: All resolve methods available
- ✅ **Request Scope Management**: Required for scoped services  
- ✅ **Discovery**: Service introspection and health checks
- ✅ **Cleanup**: Proper disposal of resources
- ❌ **No Service Registration**: Cannot add new services
- ❌ **No Building**: Already built and ready to use

### Practical Usage Example

```typescript
const configurator = new DiConfigurator();
configurator
  .addSingleton("DATABASE", () => new DatabaseService(), { eager: true })
  .addScoped("USER_CTX", () => ({ userId: "user123" }))
  .addTransient("LOGGER", () => new ConsoleLogger());

// Build creates the runtime container
const container = await configurator.build();

// ✅ Singleton services work anywhere
const logger = await container.resolve("LOGGER");
logger?.log("Application started");

// ✅ Scoped services MUST be used within request scope
await container.runWithNewRequestScope(new AsyncContextStore(), async () => {
  const userCtx = await container.resolveRequired("USER_CTX"); // Works in scope
  const database = await container.resolve("DATABASE");
  
  console.log(`Processing for user: ${userCtx.userId}`);
});

// ❌ This throws RequestScopeResolutionError:
// const userCtx = await container.resolve("USER_CTX"); // Error!

// Health check using discovery
const discovery = container.getDiscoveryService();
const eagerSingletons = discovery.getServicesByLifetime("singleton")
  .filter(s => s.singletonOptions?.eager);

console.log("Eager services initialized:", 
  eagerSingletons.every(s => s.isResolved)
);

// Cleanup when shutting down
await container.dispose();
```

### Service Discovery

Query and introspect registered services for debugging, monitoring, and dynamic resolution. The discovery service returns `IServiceRegistration` objects with detailed information about each service.

#### IServiceRegistration Interface

Each service registration returned by the discovery service contains:

| Property | Type | Description |
|----------|------|-------------|
| `token` | `TServiceToken` | The service token (string, symbol, or class) |
| `tokenType` | `"string" \| "symbol" \| "class"` | Type of the token |
| `lifetime` | `"singleton" \| "scoped" \| "transient"` | Service lifetime |
| `tag` | `string` | Service tag (defaults to "default") |
| `isResolved` | `boolean` | Whether service instance has been created |
| `singletonOptions` | `ISingletonOptions?` | Options for singleton services |
| `metatype` | `TClassType?` | Class constructor if token is a class |

#### Methods

| Method | Description |
|--------|-------------|
| `getInstance()` | Get the current service instance (if resolved) |

#### Discovery Example

```typescript
const configurator = new DiConfigurator();

// Register services
configurator.addSingleton("DATABASE", () => new DatabaseService(), { eager: true });
configurator.addScoped("USER_SERVICE", () => new UserService());
configurator.addTransient("LOGGER", () => new LoggerService());

const discovery = configurator.getDiscoveryService();

// Query by different criteria
const allServices = discovery.getAll({});
const singletons = discovery.getServicesByLifetime("singleton");
const databaseServices = discovery.getServicesByServiceToken("DATABASE");

// Work with service registrations
const databaseReg = databaseServices[0];
console.log(`Database service token: ${databaseReg.token}`);
console.log(`Token type: ${databaseReg.tokenType}`);
console.log(`Is eager: ${databaseReg.singletonOptions?.eager}`);
console.log(`Is resolved: ${databaseReg.isResolved}`);

// Health check for eager services
const eagerServices = discovery.getServicesByLifetime("singleton")
  .filter(s => s.singletonOptions?.eager)
  .map(s => ({ token: s.token, resolved: s.isResolved }));
console.log("Eager services status:", eagerServices);

// Service inventory
console.table(discovery.getAll({}).map(s => ({
  Token: s.token.toString(),
  Type: s.tokenType,
  Lifetime: s.lifetime,
  Tag: s.tag,
  Resolved: s.isResolved,
  Eager: s.singletonOptions?.eager || false
})));
```

### Advanced Features

**Circular Dependency Detection:** Automatic detection with detailed error chains:
```typescript
// This creates a circular dependency
configurator.addSingleton("ServiceA", async (cfg) => {
  await cfg.resolve("ServiceB"); // Will detect the cycle
  return new ServiceA();
});
configurator.addSingleton("ServiceB", async (cfg) => {
  await cfg.resolve("ServiceA");
  return new ServiceB();
});

// Throws CircularDependencyError with chain: ["ServiceA", "ServiceB", "ServiceA"]
```

**Complete Application Example:**
```typescript
import { DiConfigurator, IOnConstruct, IOnDispose } from "@apiratorjs/di-container";
import { AsyncContextStore } from "@apiratorjs/async-context";

// Service classes
class Config { 
  public readonly dbUrl = "mongodb://localhost"; 
}

class Database implements IOnConstruct, IOnDispose {
  constructor(private config: Config) {}
  
  async onConstruct() { console.log(`Connected to ${this.config.dbUrl}`); }
  async onDispose() { console.log("Database disconnected"); }
  
  async findUser(email: string) { return { email, id: Math.random() }; }
}

class UserService {
  constructor(private db: Database) {}
  
  async getUser(email: string) {
    return await this.db.findUser(email);
  }
}

const configurator = new DiConfigurator();

configurator
  .addSingleton("CONFIG", () => new Config(), { eager: true })
  .addSingleton("DATABASE", async (cfg) => {
    const config = await cfg.resolve("CONFIG");
    return new Database(config);
  })
  .addScoped("USER_SERVICE", async (cfg) => {
    const db = await cfg.resolve("DATABASE");
    return new UserService(db);
  });

// Usage - scoped services MUST be used within request scope
const container = await configurator.build();

await container.runWithNewRequestScope(new AsyncContextStore(), async () => {
  const userService = await container.resolve("USER_SERVICE"); // ✅ Works in scope
  const user = await userService.getUser("user@example.com");
  console.log("Found user:", user);
});

// ❌ This would throw RequestScopeResolutionError:
// const userService = await container.resolve("USER_SERVICE"); // Error!

await container.dispose(); // Cleanup
```

## Modules

Organize related services into reusable modules for better code organization:

### Class-based Modules

```typescript
class DatabaseModule implements IDiModule {
  register(configurator: DiConfigurator): void {
    configurator.addSingleton("DATABASE", () => new DatabaseConnection());
    configurator.addScoped("TRANSACTION", async (cfg) => {
      const db = await cfg.resolve("DATABASE");
      return new TransactionManager(db);
    });
  }
}
```

### Declarative Modules with DiModule.create

```typescript
// Create modular service definitions
const LoggingModule = DiModule.create({
  providers: [
    { token: "LOGGER", useFactory: () => new ConsoleLogger(), lifetime: "singleton" }
  ]
});

const DataModule = DiModule.create({
  imports: [LoggingModule],
  providers: [
    { 
      token: "DATABASE", 
      useFactory: () => new Database(), 
      lifetime: "singleton",
      singletonOptions: { eager: true }
    },
    {
      token: "USER_REPO",
      useFactory: async (cfg) => {
        const db = await cfg.resolve("DATABASE");
        const logger = await cfg.resolve("LOGGER");
        return new UserRepository(db, logger);
      },
      lifetime: "scoped"
    }
  ]
});

const AppModule = DiModule.create({
  imports: [DataModule],
  providers: [
    {
      token: "USER_SERVICE",
      useFactory: async (cfg) => {
        const repo = await cfg.resolve("USER_REPO");
        return new UserService(repo);
      },
      lifetime: "scoped"
    }
  ]
});

// Register and use - remember scoped services need request scope!
const configurator = new DiConfigurator();
configurator.addModule(AppModule);
const container = await configurator.build();

await container.runWithNewRequestScope(new AsyncContextStore(), async () => {
  const userService = await container.resolve("USER_SERVICE"); // ✅ Works in scope
});
```

**Module Features:**
- **Imports**: Import other modules to establish dependencies
- **Providers**: Define services with tokens, factories, lifecycles, and optional tags
- **Hierarchical**: Create nested module structures
- **Registration Order**: First registration wins for same token combinations

### Contributing

Contributions, issues, and feature requests are welcome!
Please open an issue or submit a pull request on [GitHub](https://github.com/apiratorjs/di-container).
