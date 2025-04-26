import { DiConfigurator } from "../src";
import { AsyncContextStore } from "@apiratorjs/async-context";
import { IOnConstruct, IOnDispose } from "../src/types";

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
