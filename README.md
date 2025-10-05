# @apiratorjs/di-container

[![NPM version](https://img.shields.io/npm/v/@apiratorjs/di-container.svg)](https://www.npmjs.com/package/@apiratorjs/di-container)
[![License: MIT](https://img.shields.io/npm/l/@apiratorjs/di-container.svg)](https://github.com/apiratorjs/di-container/blob/main/LICENSE)

A lightweight dependency injection container for JavaScript and TypeScript with powerful features: modular organization, service discovery for runtime introspection, service tagging for multiple implementations, lazy initialization, automatic circular dependency detection, and multiple service lifecycles (singleton with both in-place and lazy initialization, request-scoped, transient). Includes built-in async context management, lifecycle hooks (onConstruct/onDispose), and remains completely framework-agnostic for flexible application architecture.

> **Note:** Requires Node.js version **>=16.4.0**

---

## Features

- **Multiple Lifecycles:**

  - **Singleton:** One instance per application. By default lazily initialized (created only when requested), but can be configured for eager initialization during DI build step.
  - **Request-Scoped:** One instance per request scope using asynchronous context (lazily loaded).
  - **Transient:** A new instance on every resolution.

- **Service Tags:** Support for registering multiple implementations of the same service token using tags, enabling flexible service resolution based on context.
- **Lazy Initialization:** Services are only created when requested (default for singletons, but can be overridden with eager initialization).
- **Registration Order**: Last registration wins for same token+tag combinations
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
  async onConstruct() {
    console.log("Database connected");
  }
  async onDispose() {
    console.log("Database disconnected");
  }

  async query(sql: string) {
    return `Result for: ${sql}`;
  }
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
configurator.addSingleton("DATABASE", () => new DatabaseService(), {
  eager: true,
});

// Scoped service with dependency injection
configurator.addScoped("USER_SERVICE", async (container) => {
  const db = await container.resolve("DATABASE");
  return new UserService(db);
});

// Transient service
configurator.addTransient("LOGGER", () => ({
  log: (msg) => console.log(`[LOG] ${msg}`),
}));

// Build container (eagerly initializes singletons)
const container = await configurator.build();

// Use services - scoped services REQUIRE a request scope
await container.runWithNewRequestScope(async (container) => {
  const userService = await container.resolve("USER_SERVICE"); // ✅ Works in scope
  const logger = await container.resolve("LOGGER");

  const user = await userService.getUser("123");
  logger.log(`Retrieved user: ${user}`);
}, new AsyncContextStore());

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
await container.runWithNewRequestScope(async (container) => {
  const scopedService = await container.resolve("SCOPED_SERVICE"); // Works
}, new AsyncContextStore());

// ❌ This throws RequestScopeResolutionError
const scopedService = await container.resolve("SCOPED_SERVICE"); // Error!
```

**Service Tags (Optional):** Register multiple implementations when needed. If no tag is specified, services automatically get the "default" tag:

```typescript
configurator.addSingleton("PAYMENT", () => new StripePayment(), {
  tag: "stripe",
});
configurator.addSingleton("PAYMENT", () => new PayPalPayment(), {
  tag: "paypal",
});
configurator.addSingleton("PAYMENT", () => new BankPayment()); // Gets "default" tag automatically
```

**Registration Strategy:** When registering a service with the same token and tag combination multiple times, the **last registration wins**. This allows for service overriding and configuration flexibility:

```typescript
// First registration
configurator.addSingleton("DATABASE", () => new PostgresDatabase());

// This will override the previous registration
configurator.addSingleton("DATABASE", () => new MySQLDatabase()); // MySQL wins

// Different tags don't override each other
configurator.addSingleton("DATABASE", () => new MongoDatabase(), {
  tag: "nosql",
}); // Separate service
```

**Lifecycle Hooks:** Services can implement `onConstruct()` and `onDispose()` for automatic initialization and cleanup.

## IDiConfigurator Interface

The `IDiConfigurator` is the main interface for configuring dependency injection services. Here are all available methods:

### Service Registration Methods

| Method                                            | Description                                                               | Example                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `addSingleton<T>(token, factory, options?): this` | Register a singleton service (tag in options, defaults to "default")      | `configurator.addSingleton("DB", () => new Database(), { eager: true })`      |
| `addScoped<T>(token, factory, options?): this`    | Register a request-scoped service (tag in options, defaults to "default") | `configurator.addScoped("USER_CTX", async (container) => new UserContext())`  |
| `addTransient<T>(token, factory, options?): this` | Register a transient service (tag in options, defaults to "default")      | `configurator.addTransient("LOGGER", () => new Logger(), { tag: "console" })` |
| `addModule(module): this`                         | Register a module (calls module.register(configurator))                   | `configurator.addModule(new DatabaseModule())`                                |

#### Options Interfaces

**ISingletonServiceRegistrationOptions** (for `addSingleton`):

```typescript
interface ISingletonServiceRegistrationOptions {
  tag?: string; // Service tag (defaults to "default")
  eager?: boolean; // Should the singleton be eagerly created during container build
}
```

**IScopedServiceRegistrationOptions** (for `addScoped`):

```typescript
interface IScopedServiceRegistrationOptions {
  tag?: string; // Service tag (defaults to "default")
}
```

**ITransientServiceRegistrationOptions** (for `addTransient`):

```typescript
interface ITransientServiceRegistrationOptions {
  tag?: string; // Service tag (defaults to "default")
}
```

### Container Management Methods

| Method                                        | Description                 | Returns                                                                        |
| --------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| `build<T extends IBuildOptions>(options?: T)` | Build the runtime container | `Promise<T extends { autoInit: false } ? IInitableDiContainer : IDiContainer>` |
| `getDiscoveryService()`                       | Get discovery service       | `DiDiscoveryService` for service introspection                                 |

### Practical Example

```typescript
const configurator = new DiConfigurator();

// Registration - various lifecycles and features
configurator
  .addSingleton("CONFIG", () => ({ env: "prod" }), { eager: true })
  .addScoped("REQUEST_ID", () => Math.random().toString(36))
  .addTransient("LOGGER", () => new ConsoleLogger());

// Build container for runtime usage
const container = await configurator.build();

// Service introspection during configuration
const discovery = configurator.getDiscoveryService();
const eagerServices = discovery
  .getServicesByLifetime("singleton")
  .filter((s) => s.singletonOptions?.eager);

console.log("Eager services configured:", eagerServices.length);

// ✅ Use the container for service resolution:
await container.runWithNewRequestScope(async (container) => {
  const requestId = await container.resolve("REQUEST_ID"); // Works in scope
  const logger = await container.resolve("LOGGER");
  console.log(`Processing request: ${requestId}`);
}, new AsyncContextStore());

await container.dispose();
```

## IDiContainer Interface

The `IDiContainer` is the runtime interface for resolving services after building your DI configuration. It provides a clean, read-only interface focused on service resolution and request scope management.

### Service Resolution Methods

| Method                            | Description                                    | Returns                           |
| --------------------------------- | ---------------------------------------------- | --------------------------------- |
| `resolve<T>(token, tag?)`         | Resolve a service (optional)                   | `Promise<T \| undefined>`         |
| `resolveRequired<T>(token, tag?)` | Resolve a service (throws if not found)        | `Promise<T>`                      |
| `resolveAll<T>(token)`            | Resolve all implementations with metadata      | `Promise<IResolveAllResult<T>[]>` |
| `resolveAllRequired<T>(token)`    | Resolve all implementations (throws if none found) | `Promise<IResolveAllResult<T>[]>` |
| `resolveTagged<T>(tag)`           | Resolve first service with tag                 | `Promise<T \| undefined>`         |
| `resolveTaggedRequired<T>(tag)`   | Resolve service with tag (throws if not found) | `Promise<T>`                      |
| `resolveAllTagged(tag)`           | Resolve all services with tag and metadata     | `Promise<IResolveAllResult[]>`    |
| `resolveAllTaggedRequired(tag)`   | Resolve all services with tag (throws if none found) | `Promise<IResolveAllResult[]>`    |

#### Optional vs Required Resolution

The DI container provides two variants for each resolution method:

**Optional Methods** (`resolve`, `resolveAll`, `resolveTagged`, `resolveAllTagged`):
- Return `undefined` or empty array when no services are found
- Suitable for optional dependencies or graceful degradation scenarios
- No exceptions thrown for missing services

**Required Methods** (`resolveRequired`, `resolveAllRequired`, `resolveTaggedRequired`, `resolveAllTaggedRequired`):
- `resolveRequired` and `resolveAllRequired` throw `UnregisteredDependencyError` when no services are found
- `resolveTaggedRequired` and `resolveAllTaggedRequired` throw `UnregisteredTagError` when no services with the specified tag are found
- Suitable for critical dependencies that must exist
- Fail-fast approach for better error detection

```typescript
// Optional resolution - graceful handling
const optionalLogger = await container.resolve("LOGGER");
if (optionalLogger) {
  optionalLogger.log("Service available");
} else {
  console.log("Logger not available, using console");
}

// Required resolution - fail-fast
try {
  const requiredDatabase = await container.resolveRequired("DATABASE");
  // Guaranteed to have database instance here
  await requiredDatabase.connect();
} catch (error) {
  console.error("Critical dependency missing:", error.message);
  process.exit(1);
}

// Optional multiple resolution
const optionalPayments = await container.resolveAll("PAYMENT");
console.log(`Found ${optionalPayments.length} payment processors`); // Could be 0

// Required multiple resolution
try {
  const requiredPayments = await container.resolveAllRequired("PAYMENT");
  console.log(`Using ${requiredPayments.length} payment processors`); // At least 1
} catch (error) {
  console.error("No payment processors available!"); // Critical error
}
```

### Runtime Management Methods

| Method                                           | Description                                                      | Returns              |
| ------------------------------------------------ | ---------------------------------------------------------------- | -------------------- |
| `runWithNewRequestScope(callback, initialStore)` | Execute code in request scope (**Required** for scoped services) | `Promise<void>`      |
| `isInRequestScopeContext()`                      | Check if in request scope                                        | `boolean`            |
| `dispose()`                                      | Dispose all services (cleanup singletons and scoped services)    | `Promise<void>`      |
| `getDiscoveryService()`                          | Get discovery service for introspection                          | `DiDiscoveryService` |

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

// ✅ Singleton and transient services work anywhere
const logger = await container.resolve("LOGGER");
logger?.log("Application started");

// ✅ Scoped services MUST be used within request scope
await container.runWithNewRequestScope(async (container) => {
  const userCtx = await container.resolveRequired("USER_CTX"); // Works in scope
  const database = await container.resolve("DATABASE");

  console.log(`Processing for user: ${userCtx.userId}`);
}, new AsyncContextStore());

// ❌ This throws RequestScopeResolutionError:
// const userCtx = await container.resolve("USER_CTX"); // Error!

// Health check using discovery
const discovery = container.getDiscoveryService();
const eagerSingletons = discovery
  .getServicesByLifetime("singleton")
  .filter((s) => s.singletonOptions?.eager);

console.log(
  "Eager services initialized:",
  eagerSingletons.every((s) => s.isResolved)
);

// Cleanup when shutting down
await container.dispose();
```

### Service Discovery

Query and introspect registered services for debugging, monitoring, and dynamic resolution. The discovery service returns `IServiceRegistration` objects with detailed information about each service.

#### IResolveAllResult Interface

The `resolveAll` and `resolveAllTagged` methods return results with both the service instance and its registration metadata:

| Property       | Type                      | Description                   |
| -------------- | ------------------------- | ----------------------------- |
| `instance`     | `T`                       | The resolved service instance |
| `registration` | `IServiceRegistration<T>` | Service registration metadata |

Example usage:

```typescript
const results = await container.resolveAll<UserService>("USER_SERVICE");
results.forEach((result) => {
  console.log("Service instance:", result.instance);
  console.log("Service tag:", result.registration.tag);
  console.log("Service lifetime:", result.registration.lifetime);
  console.log("Is resolved:", result.registration.isResolved);
});

// Extract just the instances if you only need them
const instances = results.map((result) => result.instance);
```

#### IServiceRegistration Interface

Each service registration returned by the discovery service contains:

| Property           | Type                                     | Description                                                     |
| ------------------ | ---------------------------------------- | --------------------------------------------------------------- |
| `token`            | `TServiceToken`                          | The service token (string, symbol, or class)                    |
| `tokenType`        | `"string" \| "symbol" \| "class"`        | Type of the token                                               |
| `lifetime`         | `"singleton" \| "scoped" \| "transient"` | Service lifetime                                                |
| `tag`              | `string`                                 | Service tag (automatically set to "default" when not specified) |
| `isResolved`       | `boolean`                                | Whether service instance has been created                       |
| `singletonOptions` | `ISingletonOptions?`                     | Options for singleton services                                  |
| `metatype`         | `TClassType?`                            | Class constructor if token is a class                           |

#### Discovery Service Methods

| Method                             | Description                 | Returns                  |
| ---------------------------------- | --------------------------- | ------------------------ |
| `getAll()`                         | Get all registered services | `IServiceRegistration[]` |
| `getServicesByTag(tag)`            | Get services by tag         | `IServiceRegistration[]` |
| `getServicesByServiceToken(token)` | Get services by token       | `IServiceRegistration[]` |
| `getServicesByLifetime(lifetime)`  | Get services by lifetime    | `IServiceRegistration[]` |

#### IServiceRegistration Methods

| Method          | Description                                    |
| --------------- | ---------------------------------------------- |
| `getInstance()` | Get the current service instance (if resolved) |

#### Discovery Example

```typescript
const configurator = new DiConfigurator();

// Register services
configurator.addSingleton("DATABASE", () => new DatabaseService(), {
  eager: true,
});
configurator.addScoped("USER_SERVICE", () => new UserService());
configurator.addTransient("LOGGER", () => new LoggerService());

const discovery = configurator.getDiscoveryService();

// Query by different criteria
const allServices = discovery.getAll();
const singletons = discovery.getServicesByLifetime("singleton");
const databaseServices = discovery.getServicesByServiceToken("DATABASE");

// Work with service registrations
const databaseReg = databaseServices[0];
console.log(`Database service token: ${databaseReg.token}`);
console.log(`Token type: ${databaseReg.tokenType}`);
console.log(`Is eager: ${databaseReg.singletonOptions?.eager}`);
console.log(`Is resolved: ${databaseReg.isResolved}`);

// Health check for eager services
const eagerServices = discovery
  .getServicesByLifetime("singleton")
  .filter((s) => s.singletonOptions?.eager)
  .map((s) => ({ token: s.token, resolved: s.isResolved }));
console.log("Eager services status:", eagerServices);

// Service inventory
console.table(
  discovery.getAll().map((s) => ({
    Token: s.token.toString(),
    Type: s.tokenType,
    Lifetime: s.lifetime,
    Tag: s.tag,
    Resolved: s.isResolved,
    Eager: s.singletonOptions?.eager || false,
  }))
);
```

### Advanced Features

**Circular Dependency Detection:** Automatic detection with detailed error chains:

```typescript
// This creates a circular dependency
configurator.addSingleton("ServiceA", async (container) => {
  await container.resolve("ServiceB"); // Will detect the cycle
  return new ServiceA();
});
configurator.addSingleton("ServiceB", async (container) => {
  await container.resolve("ServiceA");
  return new ServiceB();
});

// Throws CircularDependencyError with chain: ["ServiceA", "ServiceB", "ServiceA"]
```

**Complete Application Example:**

```typescript
import {
  DiConfigurator,
  IOnConstruct,
  IOnDispose,
} from "@apiratorjs/di-container";
import { AsyncContextStore } from "@apiratorjs/async-context";

// Service classes
class Config {
  public readonly dbUrl = "mongodb://localhost";
}

class Database implements IOnConstruct, IOnDispose {
  constructor(private config: Config) {}

  async onConstruct() {
    console.log(`Connected to ${this.config.dbUrl}`);
  }
  async onDispose() {
    console.log("Database disconnected");
  }

  async findUser(email: string) {
    return { email, id: Math.random() };
  }
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
  .addSingleton("DATABASE", async (container) => {
    const config = await container.resolve("CONFIG");
    return new Database(config);
  })
  .addScoped("USER_SERVICE", async (container) => {
    const db = await container.resolve("DATABASE");
    return new UserService(db);
  });

// Usage - scoped services MUST be used within request scope
const container = await configurator.build();

await container.runWithNewRequestScope(async (container) => {
  const userService = await container.resolve("USER_SERVICE"); // ✅ Works in scope
  const user = await userService.getUser("user@example.com");
  console.log("Found user:", user);
}, new AsyncContextStore());

// ❌ This would throw RequestScopeResolutionError:
// const userService = await container.resolve("USER_SERVICE"); // Error!

await container.dispose(); // Cleanup all services
```

### Advanced Disposal Management

The DI container provides granular control over service disposal with three disposal methods:

#### Complete Disposal: `dispose()`

Disposes all services (both singletons and scoped services in current request scope):

```typescript
const container = await configurator.build();

// Use services...

// Dispose everything when shutting down
await container.dispose(); // Calls both disposeSingletons() and disposeScopedServices()
```

#### Singleton-Only Disposal: `disposeSingletons()`

Disposes only singleton services and clears their instances. Useful for:

- Partial cleanup scenarios
- Restarting singleton services without affecting scoped services
- Memory management in long-running applications

```typescript
const container = await configurator.build();

// Use singleton services...
const config = await container.resolve("CONFIG");
const database = await container.resolve("DATABASE");

// Later, dispose only singletons (e.g., for hot reload or reconfiguration)
await container.disposeSingletons();

// Singletons are now disposed and will be recreated on next resolution
const newDatabase = await container.resolve("DATABASE"); // Creates new instance
```

#### Scoped-Only Disposal: `disposeScopedServices()`

Disposes only scoped services in the current request scope. Useful for:

- Manual cleanup before request scope ends
- Early resource release in long-running request scopes
- Custom request lifecycle management

```typescript
await container.runWithNewRequestScope(async (container) => {
  // Use scoped services
  const userContext = await container.resolve("USER_CONTEXT");
  const sessionData = await container.resolve("SESSION_DATA");

  // Perform some operations...

  // Manually dispose scoped services before scope naturally ends
  await container.disposeScopedServices();

  // Scoped services are now disposed, but scope is still active
  // Resolving them again will create new instances
  const newUserContext = await container.resolve("USER_CONTEXT"); // Creates new instance
}, new AsyncContextStore());
```

#### Use Cases for Granular Disposal

**Hot Reload/Reconfiguration:**

```typescript
// Dispose and recreate only configuration-related singletons
await container.disposeSingletons();
// Next resolution will create fresh instances with new configuration
```

**Memory Management:**

```typescript
await container.runWithNewRequestScope(async (container) => {
  // Process large dataset
  const processor = await container.resolve("DATA_PROCESSOR");
  await processor.processLargeDataset();

  // Free memory early by disposing scoped services
  await container.disposeScopedServices();

  // Continue with lightweight operations...
}, new AsyncContextStore());
```

**Testing Scenarios:**

```typescript
// Clean up between test cases
await container.disposeSingletons(); // Reset all singleton state
```

### Working with Multiple Service Implementations

When you register multiple implementations of the same service with different tags, you can resolve them all at once:

```typescript
const configurator = new DiConfigurator();

// Register multiple payment processors
configurator.addSingleton("PAYMENT", () => new StripePayment(), {
  tag: "stripe",
});
configurator.addSingleton("PAYMENT", () => new PayPalPayment(), {
  tag: "paypal",
});
configurator.addSingleton("PAYMENT", () => new BankTransferPayment(), {
  tag: "bank",
});
configurator.addSingleton("PAYMENT", () => new CashPayment()); // No tag specified = "default" tag

const container = await configurator.build();

// Resolve all payment implementations with metadata
const paymentResults = await container.resolveAll("PAYMENT");
console.log(`Found ${paymentResults.length} payment processors`); // Will show 4 processors

paymentResults.forEach((result) => {
  console.log(`Payment processor: ${result.registration.tag}`);
  console.log(`Instance:`, result.instance);

  // Use the instance
  const payment = result.instance;
  payment.processPayment(100);
});

// Extract just the instances if you only need them
const paymentInstances = paymentResults.map((result) => result.instance);

// Or use resolveAllRequired to ensure at least one implementation exists
try {
  const requiredPayments = await container.resolveAllRequired("PAYMENT");
  console.log(`Guaranteed to have ${requiredPayments.length} payment processors`);
} catch (error) {
  console.error("No payment processors registered!"); // Throws UnregisteredDependencyError
}

// Or resolve all services with a specific tag
const stripeResults = await container.resolveAllTagged("stripe");
console.log(`Found ${stripeResults.length} services with 'stripe' tag`);

// Use resolveAllTaggedRequired to ensure services with specific tag exist
try {
  const requiredStripeServices = await container.resolveAllTaggedRequired("stripe");
  console.log(`Guaranteed to have ${requiredStripeServices.length} stripe services`);
} catch (error) {
  console.error("No services with 'stripe' tag found!"); // Throws UnregisteredTagError
}

// Resolve services with the default tag
const defaultResults = await container.resolveAllTagged("default");
console.log(`Found ${defaultResults.length} services with 'default' tag`);

// Or resolve the default payment processor directly
const defaultPayment = await container.resolveTagged("default"); // Gets CashPayment instance

await container.dispose();
```

## Modules

Organize related services into reusable modules for better code organization. Modules are simply a convenient way to group service registrations together.

```typescript
// Define service interfaces
interface ILogger {
  log(message: string): void;
}

interface IUserService {
  getCurrentUser(): string;
}

interface IAuthService {
  isAuthenticated(): boolean;
}

// Service implementations
class ConsoleLogger implements ILogger {
  log(message: string): void {
    console.log(`[LOG] ${message}`);
  }
}

class UserServiceImpl implements IUserService {
  constructor(private logger: ILogger, private authService: IAuthService) {}

  getCurrentUser(): string {
    this.logger.log("Getting current user");
    return this.authService.isAuthenticated() ? "John Doe" : "Guest";
  }
}

class AuthServiceImpl implements IAuthService {
  constructor(private logger: ILogger) {}

  isAuthenticated(): boolean {
    this.logger.log("Checking authentication");
    return true;
  }
}

// Define service tokens
const LOGGER = Symbol("LOGGER");
const USER_SERVICE = Symbol("USER_SERVICE");
const AUTH_SERVICE = Symbol("AUTH_SERVICE");

// Create modules to organize related services
class LoggingModule implements IDiModule {
  register(configurator: DiConfigurator): void {
    configurator.addSingleton(LOGGER, () => new ConsoleLogger());
  }
}

class AuthModule implements IDiModule {
  register(configurator: DiConfigurator): void {
    configurator.addSingleton(AUTH_SERVICE, async (container) => {
      const logger = await container.resolveRequired<ILogger>(LOGGER);
      return new AuthServiceImpl(logger);
    });
  }
}

class UserModule implements IDiModule {
  register(configurator: DiConfigurator): void {
    configurator.addSingleton(USER_SERVICE, async (container) => {
      const logger = await container.resolveRequired<ILogger>(LOGGER);
      const authService = await container.resolveRequired<IAuthService>(
        AUTH_SERVICE
      );
      return new UserServiceImpl(logger, authService);
    });
  }
}

// Register modules and use services
const configurator = new DiConfigurator();

configurator.addModule(new LoggingModule());
configurator.addModule(new AuthModule());
configurator.addModule(new UserModule());

const container = await configurator.build();

const userService = await container.resolveRequired<IUserService>(USER_SERVICE);
const currentUser = userService.getCurrentUser();
console.log(`Current user: ${currentUser}`);

await container.dispose();
```

**Module Features:**

- **Simple Organization**: Group related service registrations together
- **Reusability**: Modules can be reused across different applications
- **Clean Separation**: Separate concerns by domain or functionality
- **Standard Registration**: Use all standard service registration methods (addSingleton, addScoped, addTransient)
- **Dependency Injection**: Services in modules can depend on services from other modules

### Contributing

Contributions, issues, and feature requests are welcome!
Please open an issue or submit a pull request on [GitHub](https://github.com/apiratorjs/di-container).
