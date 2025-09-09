import { DiConfigurator, DiModule, IDiContainer } from "../src";

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

const LoggingModule = DiModule.create({
  providers: [
    {
      token: LOGGER,
      useFactory: () => new ConsoleLogger(),
      lifetime: "singleton",
    },
  ],
});

const AuthModule = DiModule.create({
  imports: [LoggingModule],
  providers: [
    {
      token: AUTH_SERVICE,
      useFactory: async (container: IDiContainer) => {
        const logger = await container.resolveRequired<ILogger>(LOGGER);
        return new AuthServiceImpl(logger);
      },
      lifetime: "singleton",
    },
  ],
});

const UserModule = DiModule.create({
  imports: [LoggingModule, AuthModule],
  providers: [
    {
      token: USER_SERVICE,
      useFactory: async (container: IDiContainer) => {
        const logger = await container.resolveRequired<ILogger>(LOGGER);
        const authService = await container.resolveRequired<IAuthService>(
          AUTH_SERVICE
        );
        return new UserServiceImpl(logger, authService);
      },
      lifetime: "singleton",
    },
  ],
});

const AppModule = DiModule.create({
  imports: [UserModule],
  providers: [
    // We can add additional app-specific services here
  ],
});

async function main() {
  const configurator = new DiConfigurator();

  configurator.addModule(AppModule);

  const container = await configurator.build();

  const userService = await container.resolveRequired<IUserService>(
    USER_SERVICE
  );
  const currentUser = userService.getCurrentUser();
  console.log(`Current user: ${currentUser}`);

  await container.dispose();
}

main().catch(console.error);
