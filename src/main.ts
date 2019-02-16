// This script builds the app and starts the server
import * as _ from 'lodash';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import chalk from 'chalk';

import { RequestHandler, Request, Response, NextFunction } from 'express';

import {
  ServerError,
  ServerConfig,
  BasicModule,
  ModuleType,
  RouteDefinition,
  ValidationType,
  HeaderValidator,
  BodyValidator,
  ValidatorFunction
} from './core';

const CONFIG_DEFAULT: ServerConfig = {
  port: 5000,
  verboseLogs: true
};

// Load the config file
let config: ServerConfig = {};

try {

  config = fs.readJSONSync(path.join(__dirname, 'config.json'));

}
catch (error) {

  console.log(chalk.redBright.bold('Could not find config file!'));

}

config = _.merge(CONFIG_DEFAULT, config);

const app = express();
const services: any = {};
let routers: any = {};

function installModule(filename: string): void {

  if ( ! path.basename(filename).match(/^(.+)\.((service)|(router))\.js$/) ) return;

  const modules: any[] = _.values(require(path.join(__dirname, filename)));

  for ( const module of modules ) {

    if ( typeof module !== 'function' ) continue;

    try {

      const initializedModule: BasicModule = new module();

      if ( ! initializedModule.__metadata ) continue;

      if ( initializedModule.__metadata.type === ModuleType.Service ) {

        services[initializedModule.__metadata.name] = initializedModule;
        if ( config.verboseLogs ) console.log(chalk.yellowBright.bold(`Service "${chalk.cyan(initializedModule.__metadata.name)}" installed`));

      }
      else if ( initializedModule.__metadata.type === ModuleType.Router ) {

        routers[initializedModule.__metadata.name] = initializedModule;
        if ( config.verboseLogs ) console.log(chalk.yellowBright.bold(`Router "${chalk.cyan(initializedModule.__metadata.name)}" installed`));

      }

    }
    catch {

      continue;

    }

  }

}

function scanDirRec(dir: string): string[] {

  const all: string[] = fs.readdirSync(path.join(__dirname, dir));
  let files: string[] = [];
  const dirs: string[] = [];

  for ( const item of all ) {

    const stat = fs.statSync(path.join(__dirname, dir, item));

    if ( ! stat ) continue;

    if ( stat.isDirectory() ) dirs.push(item);
    if ( stat.isFile() ) files.push(path.join(dir, item));

  }

  for ( const item of dirs ) {

    files = _.concat(files, scanDirRec(path.join(dir, item)));

  }

  return files;

}

function injectServices(modules: any): void {

  for ( const name in modules ) {

    const module = modules[name];

    if ( module.onInjection && typeof module.onInjection === 'function' ) {

      module.onInjection(services);

      if ( config.verboseLogs ) console.log(chalk.yellowBright.bold(`Services injected into ${ module.__metadata.type === ModuleType.Service ? 'service' : 'router' } "${ chalk.cyan(module.__metadata.name) }"`));

    }
    else if ( module.onConfig && typeof module.onConfig === 'function' ) {

      module.onConfig(_.cloneDeep(config));

      if ( config.verboseLogs ) console.log(chalk.yellowBright.bold(`Config injected into ${ module.__metadata.type === ModuleType.Service ? 'service' : 'router' } "${ chalk.cyan(module.__metadata.name) }"`));

    }

  }

}

function rejectForValidation(res: Response, message: string): void {

  res.status(400).json(new ServerError(message, 'VALIDATION_FAILED'));

}

function bodyValidation(bodyValidator: BodyValidator, body: any, prefix: string = ''): void|Error {

  for ( const key of _.keys(bodyValidator) ) {

    const keyPath = prefix ? prefix + '.' + key : key;

    if ( typeof bodyValidator[key] === 'function' ) {

      const validator: ValidatorFunction = <ValidatorFunction>bodyValidator[key];

      if ( ! validator(body[key]) ) return new Error(`Invalid property "${keyPath}" on body!`);

    }
    else {

      const error = bodyValidation(<BodyValidator>bodyValidator[key], body[key], keyPath);

      if ( error ) return error;

    }

  }

}

function createValidationMiddleware(route: RouteDefinition): RequestHandler {

  return (req: Request, res: Response, next: NextFunction) => {

    for ( const rule of route.validate ) {

      if ( rule.type === ValidationType.Header ) {

        for ( const key of _.keys(<HeaderValidator>rule.validator) ) {

          const header = req.header(key);

          if ( ! header || header.toLowerCase().trim() !== rule.validator[key].toLowerCase().trim() )
            return rejectForValidation(res, `Invalid header "${ key }"!`);

        }

      }
      else if ( rule.type === ValidationType.Query ) {

        for ( const query of <string[]>rule.validator ) {

          if ( ! req.query[query] ) return rejectForValidation(res, `Missing query parameter "${query}"!`);

        }

      }
      else if ( rule.type === ValidationType.Body ) {

        if ( ! req.body || typeof req.body !== 'object' || req.body.constructor !== Object )
          return rejectForValidation(res, 'Invalid body type!');

        const error = bodyValidation(<BodyValidator>rule.validator, req.body);

        if ( error ) return rejectForValidation(res, error.message);

      }
      else if ( rule.type === ValidationType.Custom ) {

        if ( ! (<ValidatorFunction>rule.validator)(req) ) return rejectForValidation(res, 'Invalid request!');

      }

    }

    next();

  };

}

// Scan the current directory
const files = scanDirRec('.');

// Install all modules
for ( const file of files ) {

  installModule(file);

}

// Inject services
injectServices(services);
injectServices(routers);

// Install body parsers
app.use(bodyParser.text());
app.use(bodyParser.json());
app.use(bodyParser.raw({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Install body parsing error
app.use((error, req, res, next) => {

  res.status(400).json(new ServerError('Invalid body!', 'INVALID_BODY'));

});

// Sort routers based on priority
routers = _.sortBy(routers, (router: BasicModule) => router.__metadata.priority);

// Install routes
for ( const name in routers ) {

  const router: BasicModule = routers[name];

  if ( ! router.__metadata.routes || ! router.__metadata.routes.length ) {

    console.log(chalk.red.bold(`Router "${ chalk.cyan(router.__metadata.name) }" has no defined routes!`));
    continue;

  }

  for ( const route of router.__metadata.routes ) {

    // Validate route definition
    if ( ! route || ! route.path || ! route.handler ) {

      console.log(chalk.red.bold(`Router "${ chalk.cyan(router.__metadata.name) }" has incorrectly defined a route!`));
      continue;

    }

    if ( ! Object.getOwnPropertyNames(Object.getPrototypeOf(router)).includes(route.handler) || typeof router[route.handler] !== 'function' ) {

      console.log(chalk.red.bold(`Route handler "${ chalk.cyan(route.handler) }" not found in router "${ chalk.cyan(router.__metadata.name) }"!`));
      continue;

    }

    // Create route handlers
    const handlers: RequestHandler[] = [];

    // Create route logger if necessary
    if ( config.verboseLogs ) {

      handlers.push((req, res, next) => {

        console.log(`[${Date.now()}]`, chalk.yellowBright(req.method.toUpperCase()), chalk.cyan(req.originalUrl)); next();

      });

    }
    // Create route validator if necessary
    if ( route.validate ) handlers.push(createValidationMiddleware(route));
    // Add the route handler provided by user
    handlers.push(router[route.handler].bind(router));

    // Install the route
    app[route.method || 'use'](route.path, ...handlers);

    if ( config.verboseLogs ) console.log(
      chalk.blueBright.bold(
        `Route "${
          chalk.yellowBright((route.method ? route.method.toUpperCase() : 'GLOBAL') + ' ' + route.path)
        }" from router "${
          chalk.yellowBright(router.__metadata.name)
        }" was installed`
      )
    );

  }

}

// Install 404 router
app.use('*', (req, res) => {

  res.status(404).json(new ServerError(`Route ${req.originalUrl} not found!`, 'ROUTE_NOT_FOUND'));

});

// Install error handler
app.use((error, req, res, next) => {

  console.log(chalk.redBright.bold(error));
  res.status(500).json(new ServerError('An internal error has occurred!'));

});

// Misc
app.disable('x-powered-by');

// Start the server
app.listen(config.port, (error: Error) => {

  if ( error ) console.log(chalk.red.bold(`Could not start the server due to an error:\n${error}`));
  else console.log(chalk.greenBright.bold(`Server started on port ${chalk.cyan('5000')}`));

});