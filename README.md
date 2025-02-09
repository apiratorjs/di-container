# @apiratorjs/di-container

[![NPM version](https://img.shields.io/npm/v/@apiratorjs/di-container.svg)](https://www.npmjs.com/package/@apiratorjs/di-container)
[![License: MIT](https://img.shields.io/npm/l/@apiratorjs/di-container.svg)](https://github.com/apiratorjs/di-container/blob/main/LICENSE)

A lightweight Node.js library, framework-agnostic, asynchronous dependency injection container for JavaScript and
TypeScript, featuring lazy initialization for services. This container supports singleton, request-scoped, and transient
service lifecycles with built-in async context management and lifecycle hooks (onConstruct/onDispose), offering a
flexible solution for managing application dependencies.

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
- **Lifecycle Hooks:** Services can implement onConstruct() and onDispose() for custom initialization and cleanup.
    - **Singleton:** Supports both onConstruct() and onDispose() hooks.
    - **Request-Scoped:** Supports both onConstruct() and onDispose() hooks.
    - **Transient:** Supports only onConstruct() hooks.
- **Concurrency Safety:** Designed to avoid race conditions during lazy instantiation.

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

await diConfigurator.runWithNewRequestScope(new AsyncContextStore(), async () => {
  const scopedInstance = await diConfigurator.resolve("MY_SCOPED");
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

### Contributing

Contributions, issues, and feature requests are welcome!
Please open an issue or submit a pull request on [GitHub](https://github.com/apiratorjs/di-container).
