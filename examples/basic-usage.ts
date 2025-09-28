import { AsyncContextStore } from "@apiratorjs/async-context";
import { DiConfigurator } from "../src";
import { IOnConstruct, IOnDispose } from "../src/types";

(async () => {
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
      return users.find((user) => user.email === email);
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
    const config = await cfg.resolveRequired(Config);
    return new DBContext(config);
  });
  diConfigurator.addScoped(UserService, async (cfg) => {
    const dbContext = await cfg.resolveRequired(DBContext);
    return new UserService(dbContext);
  });

  const diContainer = await diConfigurator.build();

  // To use request-scoped services, you need to create a new scope
  await diContainer.runWithNewRequestScope(async () => {
    const userService = await diContainer.resolveRequired(UserService);

    userService.addUser(new User("john@doe.com", 30));
  }, new AsyncContextStore());

  const user = await diContainer.runWithNewRequestScope(async () => {
    const userService = await diContainer.resolveRequired(UserService);

    return userService.getUserByEmail("john@doe.com");
  }, new AsyncContextStore());

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
