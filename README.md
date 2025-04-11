# @apiratorjs/di-container

[![NPM version](https://img.shields.io/npm/v/@apiratorjs/di-container.svg)](https://www.npmjs.com/package/@apiratorjs/di-container)
[![License: MIT](https://img.shields.io/npm/l/@apiratorjs/di-container.svg)](https://github.com/apiratorjs/di-container/blob/main/LICENSE)

A lightweight dependency injection container for JavaScript and TypeScript with powerful features: modular organization with DiModule.create, lazy initialization, automatic circular dependency detection, and multiple service lifecycles (singleton, request-scoped, transient). Includes built-in async context management, lifecycle hooks (onConstruct/onDispose), and remains completely framework-agnostic for flexible application architecture.

> **Note:** Requires Node.js version **>=16.4.0**
 
---

## Features

- **Multiple Lifecycles:**
    - **Singleton:** One instance per application (lazily loaded).
    - **Request-Scoped:** One instance per request scope using asynchronous context (lazily loaded).
    - **Transient:** A new instance on every resolution.

- **Lazy Initialization:** Services are only created when requested.
- **Async Context Management:** Leverages [@apiratorjs/async-context](https://github.com/apiratorjs/async-context) to
  manage request scopes.
- **Circular Dependency Detection:** Automatically detects and reports circular dependencies with detailed chain information through `CircularDependencyError`.
- **Lifecycle Hooks:** Services can implement onConstruct() and onDispose() for custom initialization and cleanup.
    - **Singleton:** Supports both onConstruct() and onDispose() hooks.
    - **Request-Scoped:** Supports both onConstruct() and onDispose() hooks.
    - **Transient:** Supports only onConstruct() hooks.
- **Concurrency Safety:** Designed to avoid race conditions during lazy instantiation.
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

// Register a singleton service (lazily loaded).
diConfigurator.addSingleton("MY_SINGLETON", async () => {
  return new MySingletonService();
});

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

### Service Overrides

When registering multiple services with the same token, only the last registered implementation will be used:

```typescript
// This implementation will be overridden
diConfigurator.addSingleton("MY_SERVICE", async () => {
  return new FirstImplementation();
});

// This implementation will be used when resolving MY_SERVICE
diConfigurator.addSingleton("MY_SERVICE", async () => {
  return new SecondImplementation();
});

// This works the same way for all service types (singleton, scoped, transient)
```

This behavior can be useful for overriding services in testing scenarios or when customizing default implementations.

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
