import { DiConfigurator, IDiContainer, IDiModule } from "../src";

interface ILogger {
  log(message: string): void;
}

interface IUserService {
  getCurrentUser(): string;
}

interface IAuthService {
  isAuthenticated(): boolean;
}

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

class LoggingModule implements IDiModule {
  public register(configurator: DiConfigurator) {
    configurator.addSingleton(LOGGER, () => new ConsoleLogger());
  }
}

class AuthModule {
  public register(configurator: DiConfigurator) {
    configurator.addSingleton(AUTH_SERVICE, async (container: IDiContainer) => {
      const logger = await container.resolveRequired<ILogger>(LOGGER);
      return new AuthServiceImpl(logger);
    });
  }
}

class UserModule {
  public register(configurator: DiConfigurator) {
    configurator.addSingleton(USER_SERVICE, async (container: IDiContainer) => {
      const logger = await container.resolveRequired<ILogger>(LOGGER);
      const authService = await container.resolveRequired<IAuthService>(
        AUTH_SERVICE
      );
      return new UserServiceImpl(logger, authService);
    });
  }
}

async function main() {
  const configurator = new DiConfigurator();

  configurator.addModule(new LoggingModule());
  configurator.addModule(new AuthModule());
  configurator.addModule(new UserModule());

  const container = await configurator.build();

  const userService = await container.resolveRequired<IUserService>(
    USER_SERVICE
  );
  const currentUser = userService.getCurrentUser();
  console.log(`Current user: ${currentUser}`);

  await container.dispose();
}

main().catch(console.error);
